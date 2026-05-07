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
                letterSpacing: '0.01em',
                color: 'text.primary',
            }}
        >
            {children}
        </Typography>
    );
}
