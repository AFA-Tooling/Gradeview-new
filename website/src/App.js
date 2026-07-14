import React from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import './css/app.css';
import { Route, BrowserRouter, Routes, Navigate } from 'react-router-dom';
import PrivateRoutes from './components/privateRoutes';
import AdminRoutes from './components/AdminRoutes';
import NavBar from './components/NavBar';
import Home from './views/home';
import Dashboard from './views/dashboard';
import StudentProfile from './views/studentProfile';
import Login from './views/login';
import Buckets from './views/buckets';
import HTTPError from './views/httpError';
import StudentSelectionWrapper from "./components/StudentSelectionWrapper";
import Admin from './views/admin';
import Alerts from './views/alerts';
import Settings from './views/settings';
import GradeSyncControl from './views/GradeSyncControl';
import AppShell from './components/AppShell';

const INK = '#111827';
const INK_HOVER = '#030712';
const OR_BLUE = '#4788B8';
const BORDER = '#E5E7EB';
const SOFT_BG = '#FAFAFB';

const theme = createTheme({
	palette: {
		mode: 'light',
		primary: { main: INK, dark: INK_HOVER, light: '#374151' },
		secondary: { main: OR_BLUE },
		background: { default: SOFT_BG, paper: '#FFFFFF' },
		text: {
			primary: INK,
			secondary: '#6B7280',
		},
		divider: BORDER,
	},
	typography: {
		fontFamily: ['Roboto'],
		h4: { letterSpacing: 0, fontWeight: 650 },
		h5: { letterSpacing: 0, fontWeight: 650 },
		h6: { letterSpacing: 0, fontWeight: 650 },
		button: { letterSpacing: 0 },
	},
	shape: { borderRadius: 8 },
	components: {
		MuiCssBaseline: {
			styleOverrides: {
				body: { backgroundColor: SOFT_BG, color: INK },
			},
		},
		MuiAppBar: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: {
					color: INK,
					backgroundColor: '#FFFFFF',
					backgroundImage: 'none',
					borderBottom: `1px solid ${BORDER}`,
					boxShadow: 'none',
				},
			},
		},
		MuiPaper: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: {
					backgroundImage: 'none',
					backgroundColor: '#FFFFFF',
					border: `1px solid ${BORDER}`,
					boxShadow: 'none',
				},
			},
		},
		MuiTableContainer: {
			styleOverrides: {
				root: {
					backgroundColor: '#FFFFFF',
					border: `1px solid ${BORDER}`,
					boxShadow: 'none',
				},
			},
		},
		MuiButton: {
			defaultProps: { disableElevation: true },
			styleOverrides: {
				root: {
					borderRadius: 6,
					textTransform: 'none',
					fontWeight: 500,
					boxShadow: 'none',
					'&:hover': { boxShadow: 'none' },
				},
				containedPrimary: {
					backgroundColor: INK,
					'&:hover': { backgroundColor: INK_HOVER },
				},
				outlined: {
					borderColor: BORDER,
					color: INK,
					'&:hover': {
						borderColor: '#D1D5DB',
						backgroundColor: '#F9FAFB',
					},
				},
			},
		},
		MuiOutlinedInput: {
			styleOverrides: {
				root: {
					backgroundColor: '#FFFFFF',
					borderRadius: 6,
					'& .MuiOutlinedInput-notchedOutline': {
						borderColor: BORDER,
					},
					'&:hover .MuiOutlinedInput-notchedOutline': {
						borderColor: '#D1D5DB',
					},
					'&.Mui-focused .MuiOutlinedInput-notchedOutline': {
						borderColor: INK,
						borderWidth: 1,
					},
				},
			},
		},
		MuiTabs: {
			styleOverrides: {
				indicator: { height: 2, backgroundColor: INK },
			},
		},
		MuiTab: {
			styleOverrides: {
				root: {
					textTransform: 'none',
					fontWeight: 500,
					color: '#6B7280',
					'&.Mui-selected': { color: INK },
				},
			},
		},
		MuiMenu: {
			styleOverrides: {
				paper: {
					backgroundImage: 'none',
					backgroundColor: '#FFFFFF',
					border: `1px solid ${BORDER}`,
					boxShadow: '0 4px 12px rgba(0, 0, 0, 0.06)',
				},
			},
		},
		MuiDialog: {
			styleOverrides: {
				paper: {
					backgroundImage: 'none',
					backgroundColor: '#FFFFFF',
					border: `1px solid ${BORDER}`,
					boxShadow: '0 12px 32px rgba(17, 24, 39, 0.12)',
				},
			},
		},
		MuiTableCell: {
			styleOverrides: {
				head: {
					backgroundColor: '#F9FAFB',
					color: INK,
					fontWeight: 600,
					borderBottom: `1px solid ${BORDER}`,
				},
				body: {
					color: '#374151',
					borderBottom: `1px solid ${BORDER}`,
				},
			},
		},
		MuiTableRow: {
			styleOverrides: {
				root: {
					'&:hover': { backgroundColor: '#F9FAFB' },
				},
			},
		},
		MuiChip: {
			styleOverrides: {
				root: {
					backgroundColor: '#F3F4F6',
					color: INK,
					border: 'none',
					fontWeight: 500,
				},
			},
		},
		MuiAlert: {
			styleOverrides: {
				root: {
					border: `1px solid ${BORDER}`,
					boxShadow: 'none',
				},
			},
		},
		MuiLinearProgress: {
			styleOverrides: {
				root: {
					height: 6,
					borderRadius: 3,
					backgroundColor: '#E5E7EB',
				},
				bar: { borderRadius: 3, backgroundColor: INK },
			},
		},
	},
});

console.log("%cGradeView", "color: #e3a83b; -webkit-text-stroke: 2px black; font-size: 72px; font-weight: bold; font-family: monospace;");
console.log("%cDeveloped by Connor Bernard at UC Berkeley under professor Daniel Garcia for use by CS10 and CS61C.", "color:#2299bb; font-size: 12px; font-family: monospace");

export default function App() {
	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<StudentSelectionWrapper>
				<BrowserRouter>
					<AppShell navigation={<NavBar />}>
							<Routes>
								<Route exact path='/login' element={localStorage.getItem('token') ? <Navigate to='/' /> : <Login />} />
								<Route element={<PrivateRoutes />}>
									<Route exact path='/' element={<Dashboard />} />
									<Route path='/profile' element={<StudentProfile />} />
									<Route path='/profile/*' element={<StudentProfile />} />
									<Route element={<AdminRoutes />}>
										<Route exact path='/admin' element={<Admin />} />
										<Route exact path='/gradesync' element={<GradeSyncControl />} />
										<Route exact path='/alerts' element={<Alerts />} />
										<Route exact path='/settings' element={<Settings />} />
										<Route path='/students/:studentId' element={<StudentProfile />} />
										<Route path='/students/:studentId/*' element={<StudentProfile />} />
									</Route>
								</Route>
								<Route exact path='/serverError' element={<HTTPError errorCode={500} />} />
								<Route exact path='/clientError' element={<HTTPError errorCode={400} />} />
								<Route exact path='*' element={<HTTPError errorCode={404} />} />
							</Routes>
					</AppShell>
				</BrowserRouter>
			</StudentSelectionWrapper>
		</ThemeProvider>
	);
}
