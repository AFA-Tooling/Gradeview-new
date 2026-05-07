import axios from 'axios';

const URL = window.location.origin;

const api = axios.create({
    baseURL: `${URL}/api/v2`,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');

    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = token;
    } else if (config.headers?.Authorization) {
        delete config.headers.Authorization;
    }

    return config;
});

api.interceptors.response.use(undefined, (err) => {
    const errorCode = err?.response?.status;

    if (errorCode === 401) {
        localStorage.setItem('token', '');
        window.location.href = `${URL}/login`;
        return Promise.reject(err);
    }

    return Promise.reject(err);
});

export default api;
