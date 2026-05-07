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
                py: 1.5,
                px: 2,
                bgcolor: 'background.paper',
                borderTop: 1,
                borderColor: 'divider',
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

