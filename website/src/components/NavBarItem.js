import React from 'react'
import { Button, Link, Box } from '@mui/material';
import { NavLink, useMatch } from 'react-router-dom';

export default function NavBarItem({ href, children }){
    const match = useMatch(href);
    return (
        <Link component={NavLink} to={href} color='inherit' sx={{ textDecoration: 'none' }}>
          <Button sx={{
            color: 'inherit',
            opacity: match ? 1 : 0.76,
            px: 1.5,
            borderRadius: '10px',
            position: 'relative',
            background: match ? 'linear-gradient(120deg, rgba(119,150,255,0.22), rgba(98,232,255,0.15))' : 'transparent',
            border: match ? '1px solid rgba(191, 213, 255, 0.45)' : '1px solid transparent',
            transition: 'all 180ms ease',
            '&:hover': {
              opacity: 1,
              background: 'linear-gradient(120deg, rgba(119,150,255,0.24), rgba(98,232,255,0.16))',
            },
          }}>
            {children}
            {match && (
              <Box
                className="underline"
                sx={{
                  position: 'absolute',
                  bottom: 3,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '68%',
                  height: '2px',
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, #9bb7ff, #8bf2ff)',
                  boxShadow: '0 0 14px rgba(126, 190, 255, 0.9)',
                }}
              />
          )}
        </Button>
      </Link>
    );
}
