import React from 'react';
import { useEffect, useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';
import {
    Box,
    OutlinedInput,
    Stack,
    Button,
    InputAdornment,
    IconButton,
    FormControl,
    InputLabel,
    Typography,
    Alert,
} from '@mui/material';
import axios from 'axios';
import { jwtDecode } from 'jwt-decode';

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
                    localStorage.setItem('token', loginRes?.data?.token || '');
                    localStorage.setItem('permissions', JSON.stringify(loginRes?.data?.permissions || {}));
                    const credData = decodedCredential;
                    // TODO: this is pretty awful.  We should have this in a context or something.
                    localStorage.setItem('email', credData?.email);
                    localStorage.setItem('profilepicture', credData?.picture);
                    window.location.reload(false);
                }
            })
            .catch(() => {
                setError('An error occurred.  Please try again later.');
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

            localStorage.setItem('token', data.token || '');
            localStorage.setItem('permissions', JSON.stringify(data.permissions || {}));
            localStorage.setItem('email', data.email || 'public-demo@gradeview.local');
            localStorage.setItem('name', data.name || 'GradeView Demo');
            localStorage.setItem('profilepicture', '');

            if (data.demo_course?.id) {
                localStorage.setItem('selectedCourseId', String(data.demo_course.id));
            }
            localStorage.removeItem('selectedStudentEmail');

            window.location.href = '/';
        } catch (err) {
            setError(err?.response?.data?.message || 'Demo access is not available right now.');
        } finally {
            setDemoLoading(false);
        }
    }

    // Formatting for the input fields
    const [showPassword, setShowPassword] = React.useState(false);
    const handleClickShowPassword = () => setShowPassword((show) => !show);
    const handleMouseDownPassword = (event) => {
        event.preventDefault();
    };

    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');

    function handleLogin(e) {
        e.preventDefault();
        console.log(username + ' ' + password);
        // TODO: Make a post request to the server to verify username and password
        // TODO: store retreived JWT token to localStorage
    }

    return (
        <Box
            sx={{
                minHeight: 'calc(100vh - 130px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: 2,
            }}
        >
            <form>
                <Stack
                    spacing={2}
                    className='glass-panel'
                    sx={{
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 'min(420px, 88vw)',
                        p: 4,
                        borderRadius: 4,
                    }}
                >
                    <Typography variant='h3' sx={{ fontWeight: 600, letterSpacing: '0.06em' }}>
                        Login
                    </Typography>
                    <FormControl
                        sx={{ width: '100%' }}
                        variant='outlined'
                    >
                        <InputLabel htmlFor='username'>Username</InputLabel>
                        <OutlinedInput
                            id='username'
                            autoComplete='username'
                            label='Username'
                            onChange={(e) => {
                                setUsername(e.target.value);
                            }}
                        />
                    </FormControl>
                    <FormControl
                        sx={{ width: '100%' }}
                        variant='outlined'
                    >
                        <InputLabel htmlFor='password'>Password</InputLabel>
                        <OutlinedInput
                            id='password'
                            type={showPassword ? 'text' : 'password'}
                            autoComplete='current-password'
                            endAdornment={
                                <InputAdornment position='end'>
                                    <IconButton
                                        aria-label='toggle password visibility'
                                        onClick={handleClickShowPassword}
                                        onMouseDown={handleMouseDownPassword}
                                        edge='end'
                                    >
                                        {showPassword ? (
                                            <VisibilityOff />
                                        ) : (
                                            <Visibility />
                                        )}
                                    </IconButton>
                                </InputAdornment>
                            }
                            label='Password'
                            onChange={(e) => {
                                setPassword(e.target.value);
                            }}
                        />
                    </FormControl>
                    {error && <Alert severity='error' sx={{ width: '100%' }}>{error}</Alert>}
                    <Button
                        variant='contained'
                        size='large'
                        type='button'
                        onClick={handleLogin}
                        sx={{ width: '100%' }}
                    >
                        Login
                    </Button>
                    <Button
                        variant='outlined'
                        size='large'
                        type='button'
                        startIcon={<SchoolOutlined />}
                        onClick={handleDemoLogin}
                        disabled={demoLoading}
                        sx={{ width: '100%' }}
                    >
                        {demoLoading ? 'Opening demo...' : 'Explore Demo Course'}
                    </Button>
                    <Typography variant='body2' sx={{ opacity: 0.76 }}>
                        <i>or</i>
                    </Typography>
                    <div id='googleSignInButton'></div>
                </Stack>
            </form>
        </Box>
    );
}
