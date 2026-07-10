import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { scopeProfileHrefForStaff } from '../utils/studentRoutes';

const skipLinkSx = {
  position: 'fixed',
  top: 8,
  left: 8,
  zIndex: 10000,
  px: 1.5,
  py: 1,
  borderRadius: 1,
  color: '#FFFFFF',
  backgroundColor: '#111827',
  textDecoration: 'none',
  transform: 'translateY(calc(-100% - 16px))',
  transition: 'transform 120ms ease',
  '&:focus': {
    transform: 'translateY(0)',
    outline: '3px solid #93C5FD',
    outlineOffset: 2,
  },
};

export default function AppShell({ navigation, footer, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef(null);
  const routeKey = `${location.pathname}${location.search}`;
  const previousRouteRef = useRef(routeKey);
  const isLoginRoute = location.pathname === '/login' || location.pathname === '/login/';

  useEffect(() => {
    if (previousRouteRef.current !== routeKey) {
      mainRef.current?.focus({ preventScroll: true });
      previousRouteRef.current = routeKey;
    }
  }, [routeKey]);

  const mainStyle = useMemo(() => (
    isLoginRoute
      ? {
          marginLeft: 0,
          padding: 0,
          overflow: 'auto',
          scrollbarGutter: 'auto',
          backgroundColor: '#FAFAFB',
        }
      : undefined
  ), [isLoginRoute]);

  const handleScopedStudentNavigation = useCallback((event) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

    const scopedPath = scopeProfileHrefForStaff(anchor.getAttribute('href'), {
      pathname: location.pathname,
      search: location.search,
    });
    if (!scopedPath) return;

    event.preventDefault();
    navigate(scopedPath);
  }, [location.pathname, location.search, navigate]);

  const handleSkipToMain = useCallback((event) => {
    event.preventDefault();
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  return (
    <div className="app" onClickCapture={handleScopedStudentNavigation}>
      <Box component="a" href="#main-content" sx={skipLinkSx} onClick={handleSkipToMain}>
        Skip to main content
      </Box>

      {!isLoginRoute && navigation && (
        <div className="nav" data-testid="app-navigation">
          {navigation}
        </div>
      )}

      <main
        id="main-content"
        className="content"
        tabIndex={-1}
        ref={mainRef}
        style={mainStyle}
      >
        {children}
      </main>

      {!isLoginRoute && footer}
    </div>
  );
}
