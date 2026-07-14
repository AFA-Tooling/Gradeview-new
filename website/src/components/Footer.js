import React from 'react';
import { Box, Typography, Link } from '@mui/material';
import { Email } from '@mui/icons-material';

export default function Footer() {
    const contactEmail = 'gradeview@lists.berkeley.edu';

    return (
        <Box
            component="footer"
            sx={{
                mt: 'auto',
                pt: 1.25,
                pb: 0.25,
                px: 0.75,
                borderTop: 1,
                borderColor: 'divider',
                width: '100%',
            }}
        >
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                    display: 'grid',
                    gridTemplateColumns: '18px minmax(0, 1fr)',
                    alignItems: 'start',
                    columnGap: 0.75,
                    fontSize: '0.75rem',
                }}
            >
                <Email aria-hidden="true" sx={{ mt: '2px', fontSize: 15 }} />
                <span>Need help?</span>
                <Link
                    href={`mailto:${contactEmail}`}
                    color="secondary.main"
                    underline="hover"
                    sx={{
                        gridColumn: 2,
                        minHeight: 28,
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
