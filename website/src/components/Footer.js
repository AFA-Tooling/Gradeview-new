import React from 'react';
import { Box, Typography, Link } from '@mui/material';
import { Email } from '@mui/icons-material';

export default function Footer() {
    const contactEmail = 'gradeview@lists.berkeley.edu';

    return (
        <Box
            component="footer"
            sx={{
                mt: 3,
                py: 0.75,
                px: 1,
                borderTop: 1,
                borderColor: 'divider',
                width: '100%',
            }}
        >
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 0.75,
                    flexWrap: 'wrap',
                    fontSize: '0.75rem',
                }}
            >
                <Email aria-hidden="true" sx={{ fontSize: 15, flexShrink: 0 }} />
                <span>Need help?</span>
                <Link
                    href={`mailto:${contactEmail}`}
                    color="secondary.main"
                    underline="hover"
                    sx={{
                        minHeight: 32,
                        display: 'inline-flex',
                        alignItems: 'center',
                        fontWeight: 600,
                        overflowWrap: 'anywhere',
                        '&:focus-visible': {
                            outline: '3px solid #2563EB',
                            outlineOffset: 2,
                        },
                    }}
                >
                    {contactEmail}
                </Link>
            </Typography>
        </Box>
    );
}
