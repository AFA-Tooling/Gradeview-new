import React from 'react';
import { MenuItem, ListItemIcon, ListItemText } from '@mui/material';

function NavigationMenuItem({ icon, text, onClick, ...Props}) {
    return (
        <MenuItem
            onClick={onClick}
            sx={{
                minHeight: 44,
                gap: 0.5,
                '&:focus-visible': {
                    outline: '3px solid #2563EB',
                    outlineOffset: -3,
                },
            }}
            {...Props}
        >
            <ListItemIcon>
                {React.isValidElement(icon) ? React.cloneElement(icon, { 'aria-hidden': true }) : icon}
            </ListItemIcon>
            <ListItemText primary={text} />
        </MenuItem>
    );
}

export default NavigationMenuItem;
