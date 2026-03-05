import React from 'react';
import { Box, Typography, Link } from '@mui/material';
import { Email } from '@mui/icons-material';

export default function Footer() {
    const contactEmail = 'gradeview@lists.berkeley.edu';

    return (
        <Box
            component="footer"
            sx={{
                flex: '0 0 auto',
                py: 2,
                px: 2,
                background: 'linear-gradient(120deg, rgba(31, 44, 82, 0.5), rgba(24, 34, 64, 0.42))',
                backdropFilter: 'blur(14px)',
                borderTop: '1px solid rgba(255, 255, 255, 0.2)',
                textAlign: 'center',
                width: '100%',
                zIndex: 3,
                position: 'relative',
            }}
        >
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                    color: 'rgba(229, 238, 255, 0.86)',
                }}
            >
                <Email sx={{ fontSize: 16 }} />
                <span>Questions or issues?</span>
                <Link
                    href={`mailto:${contactEmail}`}
                    color="secondary.main"
                    underline="hover"
                    sx={{ fontWeight: 500 }}
                >
                    {contactEmail}
                </Link>
            </Typography>
        </Box>
    );
}

