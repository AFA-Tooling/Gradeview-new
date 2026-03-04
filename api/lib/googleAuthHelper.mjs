import { OAuth2Client } from 'google-auth-library';
import AuthorizationError from './errors/http/AuthorizationError.js';
import { isAdmin as isUnifiedAdmin } from './unifiedConfig.mjs';
import { decodeAccessToken, verifyAccessToken } from './jwtAuth.mjs';
import { getPool } from './dbHelper.mjs';

const GOOGLE_OAUTH_CLIENT_ID_KEY = 'google_oauth_client_id';

async function getGoogleOauthClientIdForAuth() {
    try {
        const result = await getPool().query(
            'SELECT value FROM gradeview_config WHERE key = $1 LIMIT 1',
            [GOOGLE_OAUTH_CLIENT_ID_KEY],
        );

        const dbValue = String(result?.rows?.[0]?.value || '').trim();
        if (dbValue) {
            return dbValue;
        }
    } catch (error) {
        console.warn('Failed to load Google OAuth client id from DB config:', error?.message || error);
    }

    return '';
}

/**
 * Gets an email from a google auth token.
 * Accepts either an Express request object or a raw Authorization header value.
 * @param {object|string} authInput req object or Authorization header/token string.
 * @returns {string} user's email.
 */
export async function getEmailFromAuth(authInput) {

    const token = extractAuthorizationToken(authInput);

    // First, attempt to treat token as GradeView-issued JWT
    try {
        const payload = verifyAccessToken(token);
        const jwtEmail = payload?.email || payload?.sub || null;
        if (jwtEmail) {
            return String(jwtEmail).toLowerCase();
        }
    } catch {
        const decoded = decodeAccessToken(token);
        const issuer = String(decoded?.iss || '').toLowerCase();
        if (issuer === 'gradeview-api') {
            throw new AuthorizationError('Session token is invalid or expired. Please sign in again.');
        }
        // Not a valid GradeView JWT, continue with Google ID token validation.
    }

    const googleOauthAudience = await getGoogleOauthClientIdForAuth();
    if (!googleOauthAudience) {
        throw new AuthorizationError('Google OAuth client ID is not configured in gradeview_config.');
    }
    
    // Retry logic for handling Google key rotation
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            let oauthClient = new OAuth2Client(googleOauthAudience);
            const ticket = await oauthClient.verifyIdToken({
                idToken: token,
                audience: googleOauthAudience,
            });
            const payload = ticket.getPayload();
            if (payload['hd'] !== 'berkeley.edu') {
                throw new AuthorizationError('domain mismatch');
            }
            return payload['email'];
        } catch (err) {
            lastError = err;
            // Retry on certificate errors (Google key rotation)
            if (err.message && err.message.includes('No pem found') && attempt === 0) {
                console.warn('Google certificate not found, retrying with fresh client...');
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }
            break;
        }
    }
    
    console.error('Error during Google authorization:', lastError);
    const debugReason = String(lastError?.message || '').trim();
    throw new AuthorizationError(
        debugReason
            ? `Could not authenticate authorization token. ${debugReason}`
            : 'Could not authenticate authorization token.',
    );
}

function extractAuthorizationToken(authInput) {
    let headerValue = null;

    if (typeof authInput === 'string') {
        headerValue = authInput;
    } else if (authInput && typeof authInput === 'object') {
        headerValue = authInput?.headers?.authorization || authInput?.authorization || null;
    }

    if (!headerValue || typeof headerValue !== 'string') {
        throw new AuthorizationError('no authorization token provided.');
    }

    const trimmed = headerValue.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
        return trimmed.slice(7).trim();
    }

    return trimmed;
}

/**
 * Ensures that an email is a properly formatted berkeley email.
 * @param {string} email email to verify.
 * @returns {boolean} success of verification.
 * @deprecated
 */
export function verifyBerkeleyEmail(email) {
    return (
        email.split('@').length === 2 && email.split('@')[1] === 'berkeley.edu'
    );
}

// TODO: check if the user is included in the list of users (in the db);
/**
 * Checks to see if an email is a student email or an admin.
 * @param {string} email email to check access to.
 * @returns {boolean} whether the email is an admin or student.
 * @deprecated use api/lib/userlib.mjs middlewares instead.
 */
export function ensureStudentOrAdmin(email) {
    const isAdmin = isUnifiedAdmin(email);
    return isAdmin;
}
