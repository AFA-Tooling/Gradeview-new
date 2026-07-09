import React from 'react';
import { useEffect, useState } from 'react';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';
import {
    Box,
    Stack,
    Button,
    Typography,
    Alert,
    Divider,
    Paper,
} from '@mui/material';
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import {
    persistShellLoginSession,
} from '../utils/personaNavigation';

export default function Login() {
    const [error, setError] = useState(false);
    const [demoLoading, setDemoLoading] = useState(false);

    // Initialize the google OAUTH
    useEffect(() => {
        if (!window.google?.accounts?.id) {
            return;
        }

        window.google.accounts.id.initialize({
            client_id:
                '960156693240-hje09pstet1al4g4tr08271kkcjfqnn2.apps.googleusercontent.com',
            callback: handleGoogleLogin,
        });
        window.google.accounts.id.renderButton(
            document.querySelector('#googleSignInButton'),
            {},
        );
    }, []);

    // Updates OAuth2 token to be the local token value
    async function handleGoogleLogin(authData) {
        const decodedCredential = jwtDecode(authData.credential);
        const googleToken = `Bearer ${authData.credential}`;
        axios
            .get(`/api/v2/login`, {
                headers: { Authorization: googleToken },
            })
            .then((loginRes) => {
                if (!loginRes.data.status) {
                    setError(
                        loginRes?.data?.message
                        || 'You are not assigned as a student or staff in any active course. Please contact course staff if you think this is a mistake.',
                    );
                    return;
                } else {
                    const credData = decodedCredential;
                    persistShellLoginSession(localStorage, {
                        loginData: loginRes?.data,
                        identity: {
                            email: credData?.email,
                            name: credData?.name,
                            profilepicture: credData?.picture,
                        },
                    });
                    window.location.reload(false);
                }
            })
            .catch((err) => {
                const errorMessage = err?.response?.data?.message
                    || err?.response?.data?.detail
                    || 'An error occurred. Please try again later.';
                setError(errorMessage);
            });
    }

    async function handleDemoLogin() {
        setError(false);
        setDemoLoading(true);

        try {
            const loginRes = await axios.post('/api/v2/login/demo');
            const data = loginRes?.data || {};

            if (!data.status) {
                setError(data.message || 'Demo access is not available right now.');
                return;
            }

            persistShellLoginSession(localStorage, {
                loginData: data,
                identity: {
                    email: data.email || 'public-demo@gradeview.local',
                    name: data.name || 'GradeView Demo',
                    profilepicture: '',
                },
                selectedCourseId: data.demo_course?.id,
            });

            window.location.href = '/';
        } catch (err) {
            setError(err?.response?.data?.message || 'Demo access is not available right now.');
        } finally {
            setDemoLoading(false);
        }
    }

    return (
        <Box
            className="login-shell"
            sx={{
                minHeight: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: { xs: 2, sm: 3 },
                py: { xs: 2, sm: 3 },
            }}
        >
            <Paper
                className='glass-panel'
                sx={{
                    width: 'min(480px, 100%)',
                    p: { xs: 3, sm: 4 },
                    borderRadius: 2,
                }}
            >
                <Stack
                    spacing={2.5}
                    sx={{
                        alignItems: 'stretch',
                    }}
                >
                    <Box>
                        <Typography component="h1" variant='h4' sx={{ fontWeight: 700, mb: 0.75 }}>
                            Sign in to GradeView
                        </Typography>
                        <Typography variant='body2' color='text.secondary'>
                            Use your Berkeley Google account to view course grades and staff tools.
                        </Typography>
                    </Box>

                    {error && <Alert severity='error' role="alert" sx={{ width: '100%' }}>{error}</Alert>}

                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            py: 0.5,
                            minHeight: 44,
                        }}
                    >
                        <div id='googleSignInButton'></div>
                    </Box>

                    <Divider>
                        <Typography variant='caption' color='text.secondary'>
                            or
                        </Typography>
                    </Divider>

                    <Button
                        variant='outlined'
                        size='large'
                        type='button'
                        startIcon={<SchoolOutlined />}
                        onClick={handleDemoLogin}
                        disabled={demoLoading}
                        sx={{ width: '100%' }}
                    >
                        {demoLoading ? 'Opening demo...' : 'Explore Read-only Demo'}
                    </Button>
                </Stack>
            </Paper>
        </Box>
    );
}
