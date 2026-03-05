import React from 'react';
import { Typography } from '@mui/material';

export default function PageHeader({ children }) {
    return (
        <Typography
            variant='h5'
            component='div'
            sx={{
                m: 2,
                fontWeight: 600,
                letterSpacing: '0.02em',
                background: 'linear-gradient(90deg, #dce9ff, #90b0ff, #8df1ff)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textShadow: '0 0 18px rgba(125, 173, 255, 0.35)',
            }}
        >
            {children}
        </Typography>
    );
}
