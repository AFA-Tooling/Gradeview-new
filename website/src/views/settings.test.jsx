import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './settings';
import apiv2 from '../utils/apiv2';

jest.mock('../utils/apiv2', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        put: jest.fn(),
    },
}));

const VIEW_CONFIG = {
    admins: ['admin@berkeley.edu'],
    googleconfig: { oauth: { clientid: 'client-before' } },
};

const SYNC_CONFIG = {
    global_settings: {
        csv_output_dir: 'data/exports',
        log_level: 'INFO',
        retry_attempts: 3,
        retry_delay_seconds: 5,
    },
    courses: [],
};

function setSession({ readOnly = false } = {}) {
    localStorage.setItem('permissions', JSON.stringify({
        has_course_admin: true,
        is_demo: readOnly,
        read_only: readOnly,
    }));
    if (readOnly) {
        localStorage.setItem('shellUiCapabilities', JSON.stringify({ demo: true, read_only: true }));
    }
}

function mockSuccessfulReads() {
    apiv2.get.mockImplementation((path) => Promise.resolve({
        data: path === '/config' ? VIEW_CONFIG : SYNC_CONFIG,
    }));
}

describe('Settings request and capability states', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        setSession();
        apiv2.put.mockResolvedValue({ data: { status: true } });
    });

    it('allows a normal staff user to update and save loaded configuration', async () => {
        mockSuccessfulReads();
        const user = userEvent.setup();
        render(<Settings />);

        const clientId = await screen.findByLabelText('Client ID');
        await user.clear(clientId);
        await user.type(clientId, 'client-after');
        await user.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => expect(apiv2.put).toHaveBeenCalledTimes(2));
        expect(apiv2.put).toHaveBeenNthCalledWith(
            1,
            '/config',
            expect.objectContaining({
                googleconfig: { oauth: { clientid: 'client-after' } },
            }),
        );
        expect(await screen.findByText('Configuration saved successfully')).toBeInTheDocument();
    });

    it.each([
        [
            {
                response: {
                    status: 403,
                    data: {
                        code: 'COURSE_SCOPE_FORBIDDEN',
                        reason: 'Settings are outside this course scope.',
                        recovery: 'Choose an authorized course.',
                    },
                },
            },
            'COURSE_SCOPE_FORBIDDEN',
            'Settings are outside this course scope.',
        ],
        [
            { response: { status: 500, data: { reason: 'Configuration storage is unavailable.' } } },
            'CONFIG_SERVICE_UNAVAILABLE',
            'Configuration storage is unavailable.',
        ],
        [
            { code: 'ECONNABORTED', message: 'timeout' },
            'SETTINGS_TIMEOUT',
            'GradeView configuration did not load before the request timed out.',
        ],
    ])('preserves a structured read failure instead of rendering an empty settings page', async (failure, code, reason) => {
        apiv2.get.mockImplementation((path) => (
            path === '/config' ? Promise.reject(failure) : Promise.resolve({ data: SYNC_CONFIG })
        ));
        render(<Settings />);

        expect(await screen.findByText(new RegExp(code))).toBeInTheDocument();
        expect(screen.getByText(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry settings' })).toBeEnabled();
        expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
    });

    it('retries a failed read to success without reloading the page and clears the old error', async () => {
        let configAttempts = 0;
        apiv2.get.mockImplementation((path) => {
            if (path === '/config') {
                configAttempts += 1;
                if (configAttempts === 1) {
                    return Promise.reject({
                        response: {
                            status: 500,
                            data: {
                                code: 'CONFIG_READ_FAILED',
                                reason: 'Temporary database failure.',
                                recovery: 'Retry the request.',
                            },
                        },
                    });
                }
                return Promise.resolve({ data: VIEW_CONFIG });
            }
            return Promise.resolve({ data: SYNC_CONFIG });
        });
        const user = userEvent.setup();
        render(<Settings />);

        expect(await screen.findByText(/CONFIG_READ_FAILED/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Retry settings' }));

        expect(await screen.findByLabelText('Client ID')).toHaveValue('client-before');
        expect(screen.queryByText(/CONFIG_READ_FAILED/)).not.toBeInTheDocument();
        expect(configAttempts).toBe(2);
    });

    it('disables Demo mutations on both settings tabs before any write request', async () => {
        localStorage.clear();
        setSession({ readOnly: true });
        mockSuccessfulReads();
        const user = userEvent.setup();
        render(<Settings />);

        expect(await screen.findByText('Read-only Demo')).toBeInTheDocument();
        expect(screen.getByLabelText('Add New Admin')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add administrator' })).toBeDisabled();
        expect(screen.getByLabelText('Client ID')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled();

        await user.click(screen.getByRole('tab', { name: /GradeSync Configuration/ }));
        expect(screen.getByLabelText('CSV Output Directory')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add Course' })).toBeDisabled();
        expect(screen.queryByRole('combobox', { name: /^(current )?course$/i })).not.toBeInTheDocument();
        expect(screen.getByText(/empty configuration, not a load error/i)).toBeInTheDocument();
        expect(apiv2.put).not.toHaveBeenCalled();
    });

    it('aborts hanging configuration reads and offers in-page timeout recovery', async () => {
        apiv2.get.mockImplementation((path, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const error = new Error('canceled');
                error.code = 'ERR_CANCELED';
                reject(error);
            });
        }));
        jest.useFakeTimers();
        render(<Settings />);

        await act(async () => {
            jest.advanceTimersByTime(15000);
            await Promise.resolve();
        });

        expect(screen.getByText(/SETTINGS_TIMEOUT/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry settings' })).toBeEnabled();
        jest.useRealTimers();
    });
});
