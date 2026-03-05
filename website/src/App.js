import React, { useEffect, useMemo, useState } from 'react';
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

const DISPLAY_MODE_KEY = 'gradeviewDisplayMode';

const createAppTheme = (mode) => {
  const isDark = mode === 'dark';

  return createTheme({
	palette: {
		mode,
		primary: {
			main: isDark ? '#5a78ff' : '#3558d6',
		},
		secondary: {
			main: isDark ? '#5be7ff' : '#0ea5e9',
		},
		background: {
			default: isDark ? '#060913' : '#eef3ff',
			paper: isDark ? 'rgba(16, 24, 42, 0.55)' : 'rgba(255, 255, 255, 0.92)',
		},
		text: {
			primary: isDark ? '#eaf2ff' : '#10243f',
			secondary: isDark ? 'rgba(224, 234, 255, 0.78)' : 'rgba(16, 36, 63, 0.72)',
		},
	},
	typography: {
		fontFamily: [
			'Roboto'
		],
	},
	shape: {
		borderRadius: 16,
	},
	components: {
		MuiCssBaseline: {
			styleOverrides: {
				body: {
					backgroundColor: isDark ? '#060913' : '#eef3ff',
					color: isDark ? '#eaf2ff' : '#10243f',
				},
			},
		},
		MuiAppBar: {
			styleOverrides: {
				root: {
					color: isDark ? '#eaf2ff' : '#18315a',
					background: isDark
						? 'linear-gradient(120deg, rgba(39,58,126,0.58), rgba(24,32,63,0.5))'
						: 'linear-gradient(120deg, rgba(235,243,255,0.92), rgba(224,234,255,0.86))',
					backdropFilter: 'blur(18px)',
					borderBottom: isDark
						? '1px solid rgba(255,255,255,0.16)'
						: '1px solid rgba(53, 88, 168, 0.2)',
					boxShadow: isDark
						? '0 12px 40px rgba(0,0,0,0.32)'
						: '0 10px 24px rgba(35, 73, 145, 0.14)',
				},
			},
		},
		MuiPaper: {
			styleOverrides: {
				root: {
					background: isDark
						? 'linear-gradient(145deg, rgba(255,255,255,0.13), rgba(255,255,255,0.02))'
						: 'linear-gradient(145deg, rgba(255,255,255,0.92), rgba(245,249,255,0.96))',
					backdropFilter: 'blur(16px)',
					border: isDark
						? '1px solid rgba(255,255,255,0.2)'
						: '1px solid rgba(40, 74, 149, 0.12)',
					boxShadow: isDark
						? '0 16px 42px rgba(2, 8, 25, 0.35)'
						: '0 12px 28px rgba(36, 72, 141, 0.12)',
				},
			},
		},
		MuiTableContainer: {
			styleOverrides: {
				root: {
					background: isDark
						? 'linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.03))'
						: 'linear-gradient(160deg, rgba(255,255,255,0.9), rgba(244,248,255,0.95))',
					backdropFilter: 'blur(16px)',
					border: isDark
						? '1px solid rgba(255,255,255,0.18)'
						: '1px solid rgba(40, 74, 149, 0.12)',
				},
			},
		},
		MuiButton: {
			styleOverrides: {
				root: {
					borderRadius: 12,
					textTransform: 'none',
					fontWeight: 600,
				},
				containedPrimary: {
					background: isDark
						? 'linear-gradient(120deg, #4f66ff 0%, #4ac7ff 100%)'
						: 'linear-gradient(120deg, #4c63f1 0%, #3aa9e9 100%)',
					boxShadow: isDark
						? '0 8px 24px rgba(77,120,255,0.35)'
						: '0 8px 20px rgba(62, 104, 211, 0.26)',
				},
				outlined: {
					borderColor: isDark ? 'rgba(198,216,255,0.55)' : 'rgba(62, 103, 197, 0.42)',
					backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.65)',
				},
			},
		},
		MuiOutlinedInput: {
			styleOverrides: {
				root: {
					backgroundColor: isDark ? 'rgba(12, 18, 35, 0.56)' : 'rgba(255, 255, 255, 0.92)',
					backdropFilter: 'blur(12px)',
					borderRadius: 12,
					color: isDark ? '#f3f8ff' : '#183154',
					'& .MuiOutlinedInput-notchedOutline': {
						borderColor: isDark ? 'rgba(167,190,245,0.35)' : 'rgba(53, 88, 168, 0.3)',
					},
					'&:hover .MuiOutlinedInput-notchedOutline': {
						borderColor: isDark ? 'rgba(201,219,255,0.75)' : 'rgba(53, 88, 168, 0.55)',
					},
					'&.Mui-focused .MuiOutlinedInput-notchedOutline': {
						borderColor: isDark ? '#70c6ff' : '#3c63dd',
					},
				},
			},
		},
		MuiTabs: {
			styleOverrides: {
				indicator: {
					height: 3,
					borderRadius: 999,
					background: 'linear-gradient(90deg, #80a6ff, #73e8ff)',
				},
			},
		},
		MuiTab: {
			styleOverrides: {
				root: {
					textTransform: 'none',
					color: isDark ? 'rgba(222,232,255,0.8)' : 'rgba(28, 58, 110, 0.72)',
					'&.Mui-selected': {
						color: isDark ? '#ffffff' : '#1c3d8f',
					},
				},
			},
		},
		MuiMenu: {
			styleOverrides: {
				paper: {
					background: isDark
						? 'linear-gradient(145deg, rgba(35,48,92,0.82), rgba(19,26,54,0.85))'
						: 'linear-gradient(145deg, rgba(255,255,255,0.96), rgba(243,248,255,0.98))',
					backdropFilter: 'blur(14px)',
					border: isDark ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(40, 74, 149, 0.16)',
				},
			},
		},
		MuiDialog: {
			styleOverrides: {
				paper: {
					background: isDark
						? 'linear-gradient(145deg, rgba(26,36,70,0.92), rgba(16,22,45,0.92))'
						: 'linear-gradient(145deg, rgba(255,255,255,0.98), rgba(241,247,255,0.98))',
					backdropFilter: 'blur(18px)',
					border: isDark ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(40, 74, 149, 0.16)',
				},
			},
		},
		MuiTableCell: {
			styleOverrides: {
				head: {
					backgroundColor: isDark ? 'rgba(87, 123, 255, 0.12)' : 'rgba(215, 227, 255, 0.84)',
					color: isDark ? '#eaf2ff' : '#1a376a',
					borderBottom: isDark
						? '1px solid rgba(255,255,255,0.2)'
						: '1px solid rgba(53, 88, 168, 0.24)',
				},
				body: {
					color: isDark ? 'rgba(236, 243, 255, 0.92)' : 'rgba(22, 42, 76, 0.92)',
					borderBottom: isDark
						? '1px solid rgba(255,255,255,0.08)'
						: '1px solid rgba(53, 88, 168, 0.14)',
				},
			},
		},
		MuiTableRow: {
			styleOverrides: {
				root: {
					'&:hover': {
						backgroundColor: isDark ? 'rgba(111, 150, 255, 0.09)' : 'rgba(96, 130, 200, 0.12)',
					},
				},
			},
		},
		MuiChip: {
			styleOverrides: {
				root: {
					background: isDark ? 'rgba(97, 135, 255, 0.18)' : 'rgba(84, 121, 210, 0.14)',
					color: isDark ? '#eaf2ff' : '#1f3f77',
					border: isDark ? '1px solid rgba(162, 189, 255, 0.3)' : '1px solid rgba(84, 121, 210, 0.24)',
				},
			},
		},
		MuiAlert: {
			styleOverrides: {
				root: {
					border: isDark ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(53, 88, 168, 0.2)',
					backdropFilter: 'blur(8px)',
				},
			},
		},
		MuiLinearProgress: {
			styleOverrides: {
				root: {
					height: 7,
					borderRadius: 999,
					backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(53, 88, 168, 0.16)',
				},
				bar: {
					borderRadius: 999,
					background: 'linear-gradient(90deg, #7c9aff, #71edff)',
				},
			},
		},
	},
});
};

console.log("%cGradeView", "color: #e3a83b; -webkit-text-stroke: 2px black; font-size: 72px; font-weight: bold; font-family: monospace;");
console.log("%cDeveloped by Connor Bernard at UC Berkeley under professor Daniel Garcia for use by CS10 and CS61C.", "color:#2299bb; font-size: 12px; font-family: monospace");

export default function App() {
	const [displayMode, setDisplayMode] = useState(() => {
		const saved = localStorage.getItem(DISPLAY_MODE_KEY);
		return saved === 'light' ? 'light' : 'dark';
	});

	const theme = useMemo(() => createAppTheme(displayMode), [displayMode]);

	useEffect(() => {
		localStorage.setItem(DISPLAY_MODE_KEY, displayMode);
	}, [displayMode]);

	const handleToggleDisplayMode = () => {
		setDisplayMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
	};

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<StudentSelectionWrapper>
				<div className={`app ${displayMode === 'light' ? 'app-light' : 'app-dark'}`}>
					<BrowserRouter>
						<div className="nav">
							<NavBar displayMode={displayMode} onToggleDisplayMode={handleToggleDisplayMode} />
						</div>
						<div className="content">
							<Routes>
								<Route exact path='/login' element={localStorage.getItem('token') ? <Navigate to='/' /> : <Login />} />
								<Route element={<PrivateRoutes />}>
									<Route exact path='/' element={<Dashboard />} />
									<Route exact path='/profile' element={<StudentProfile />} />
									<Route element={<AdminRoutes />}>
								<Route exact path='/admin' element={<Admin displayMode={displayMode} />} />
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
