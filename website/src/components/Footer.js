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
                minHeight: 48,
                py: 1.25,
                px: 2,
                bgcolor: 'background.paper',
                borderTop: 1,
                borderColor: 'divider',
                textAlign: 'center',
                width: '100%',
                zIndex: 'auto',
                position: 'static',
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
                <Email aria-hidden="true" sx={{ fontSize: 18, flexShrink: 0 }} />
                <span>Questions or issues?</span>
                <Link
                    href={`mailto:${contactEmail}`}
                    color="secondary.main"
                    underline="hover"
                    sx={{
                        minHeight: 44,
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
