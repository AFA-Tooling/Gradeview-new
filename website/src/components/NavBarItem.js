import React from 'react'
import { Button, Link, Box } from '@mui/material';
import { NavLink, useMatch } from 'react-router-dom';

export default function NavBarItem({ href, children }){
    const match = useMatch(href);
    return (
        <Link component={NavLink} to={href} color='inherit' sx={{ textDecoration: 'none' }}>
          <Button sx={{
            color: match ? 'primary.main' : 'text.secondary',
            px: 1.5,
            borderRadius: '6px',
            position: 'relative',
            background: 'transparent',
            border: '1px solid transparent',
            fontWeight: match ? 600 : 500,
            transition: 'color 150ms ease, background 150ms ease',
            '&:hover': {
              color: 'primary.main',
              background: (theme) => theme.palette.mode === 'dark' ? 'rgba(90,155,212,0.08)' : 'rgba(0,50,98,0.04)',
            },
          }}>
            {children}
            {match && (
              <Box
                className="underline"
                sx={{
                  position: 'absolute',
                  bottom: 2,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '60%',
                  height: '2px',
                  borderRadius: 1,
                  bgcolor: 'primary.main',
                }}
              />
          )}
        </Button>
      </Link>
    );
}
