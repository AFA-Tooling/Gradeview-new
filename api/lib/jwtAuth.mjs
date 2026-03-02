import jwt from 'jsonwebtoken';

const JWT_ISSUER = 'gradeview-api';
const DEFAULT_EXPIRY = '12h';

function getJwtSecret() {
    return process.env.JWT_SECRET || 'gradeview-dev-secret-change-me';
}

export function signAccessToken(payload) {
    return jwt.sign(payload, getJwtSecret(), {
        issuer: JWT_ISSUER,
        expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRY,
    });
}

export function verifyAccessToken(token) {
    return jwt.verify(token, getJwtSecret(), {
        issuer: JWT_ISSUER,
    });
}

export function decodeAccessToken(token) {
    return jwt.decode(token);
}
