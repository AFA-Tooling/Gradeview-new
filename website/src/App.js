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
import Footer from './components/Footer';
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

// Mono palette
const INK = '#111111';
const INK_HOVER = '#000000';

const theme = createTheme({
	palette: {
		mode: 'light',
		primary: { main: INK, dark: INK_HOVER, light: '#444444' },
		secondary: { main: '#555555' },
		background: { default: '#E8EAEE', paper: '#FFFFFF' },
		text: {
			primary: '#111111',
			secondary: 'rgba(0, 0, 0, 0.62)',
		},
		divider: 'rgba(0, 0, 0, 0.22)',
	},
	typography: { fontFamily: ['Roboto'] },
	shape: { borderRadius: 8 },
	components: {
		MuiCssBaseline: {
			styleOverrides: {
				body: { backgroundColor: '#E8EAEE', color: '#111111' },
			},
		},
		MuiAppBar: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: {
					color: '#111111',
					backgroundColor: '#FFFFFF',
					backgroundImage: 'none',
					borderBottom: '1px solid rgba(0, 0, 0, 0.18)',
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
					border: '1px solid rgba(0, 0, 0, 0.18)',
					boxShadow: 'none',
				},
			},
		},
		MuiTableContainer: {
			styleOverrides: {
				root: {
					backgroundColor: '#FFFFFF',
					border: '1px solid rgba(0, 0, 0, 0.18)',
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
				outlined: { borderColor: 'rgba(0, 0, 0, 0.45)' },
			},
		},
		MuiOutlinedInput: {
			styleOverrides: {
				root: {
					backgroundColor: '#FFFFFF',
					borderRadius: 6,
					'& .MuiOutlinedInput-notchedOutline': {
						borderColor: 'rgba(0, 0, 0, 0.28)',
					},
					'&:hover .MuiOutlinedInput-notchedOutline': {
						borderColor: 'rgba(0, 0, 0, 0.45)',
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
					color: 'rgba(0, 0, 0, 0.55)',
					'&.Mui-selected': { color: INK },
				},
			},
		},
		MuiMenu: {
			styleOverrides: {
				paper: {
					backgroundImage: 'none',
					backgroundColor: '#FFFFFF',
					border: '1px solid rgba(0, 0, 0, 0.18)',
					boxShadow: '0 4px 12px rgba(0, 0, 0, 0.06)',
				},
			},
		},
		MuiDialog: {
			styleOverrides: {
				paper: {
					backgroundImage: 'none',
					backgroundColor: '#FFFFFF',
					border: '1px solid rgba(0, 0, 0, 0.18)',
					boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
				},
			},
		},
		MuiTableCell: {
			styleOverrides: {
				head: {
					backgroundColor: '#EDEEF1',
					color: '#111111',
					fontWeight: 600,
					borderBottom: '1px solid rgba(0, 0, 0, 0.18)',
				},
				body: {
					color: 'rgba(0, 0, 0, 0.85)',
					borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
				},
			},
		},
		MuiTableRow: {
			styleOverrides: {
				root: {
					'&:hover': { backgroundColor: 'rgba(0, 0, 0, 0.04)' },
				},
			},
		},
		MuiChip: {
			styleOverrides: {
				root: {
					backgroundColor: 'rgba(0, 0, 0, 0.06)',
					color: INK,
					border: 'none',
					fontWeight: 500,
				},
			},
		},
		MuiAlert: {
			styleOverrides: {
				root: {
					border: '1px solid rgba(0, 0, 0, 0.18)',
					boxShadow: 'none',
				},
			},
		},
		MuiLinearProgress: {
			styleOverrides: {
				root: {
					height: 6,
					borderRadius: 3,
					backgroundColor: 'rgba(0, 0, 0, 0.22)',
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
				<div className="app">
					<BrowserRouter>
						<div className="nav">
							<NavBar />
						</div>
						<div className="content">
							<Routes>
								<Route exact path='/login' element={localStorage.getItem('token') ? <Navigate to='/' /> : <Login />} />
								<Route element={<PrivateRoutes />}>
									<Route exact path='/' element={<Dashboard />} />
									<Route exact path='/profile' element={<StudentProfile />} />
									<Route element={<AdminRoutes />}>
										<Route exact path='/admin' element={<Admin />} />
										<Route exact path='/gradesync' element={<GradeSyncControl />} />
										<Route exact path='/alerts' element={<Alerts />} />
										<Route exact path='/settings' element={<Settings />} />
									</Route>
								</Route>
								<Route exact path='/serverError' element={<HTTPError errorCode={500} />} />
								<Route exact path='/clientError' element={<HTTPError errorCode={400} />} />
								<Route exact path='*' element={<HTTPError errorCode={404} />} />
							</Routes>
						</div>
						<Footer />
					</BrowserRouter>
				</div>
			</StudentSelectionWrapper>
		</ThemeProvider>
	);
}
