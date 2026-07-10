import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GradeSyncControl from './GradeSyncControl';
import apiv2 from '../utils/apiv2';

jest.mock('../utils/apiv2', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

jest.mock('../utils/apiCache', () => ({
    clearApiGetCache: jest.fn(),
}));

const COURSE_RESPONSE = {
    data: {
        courses: [{
            id: '1',
            gradescope_course_id: 'demo-course',
            name: 'Demo Course',
            year: 2026,
            semester: 'Spring',
        }],
    },
};

function setSession({ readOnly = false } = {}) {
    localStorage.setItem('selectedCourseId', '1');
    localStorage.setItem('permissions', JSON.stringify({
        has_course_admin: true,
        is_demo: readOnly,
        read_only: readOnly,
    }));
    if (readOnly) {
        localStorage.setItem('shellUiCapabilities', JSON.stringify({ demo: true, read_only: true }));
    }
}

describe('GradeSync platform states', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        apiv2.get.mockResolvedValue(COURSE_RESPONSE);
    });

    it('uses the global course as static context and renders a successful empty-detail result', async () => {
        setSession();
        const user = userEvent.setup();
        apiv2.post.mockResolvedValue({
            data: { status: 'completed', overall_success: true, results: [] },
        });
        render(<GradeSyncControl />);

        expect(await screen.findByText('2026 Spring Demo Course')).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Start Sync for current course' }));

        expect(await screen.findByText('The sync completed successfully for the current course.')).toBeInTheDocument();
        expect(screen.getByText(/successful empty detail set/i)).toBeInTheDocument();
        expect(apiv2.post).toHaveBeenCalledWith(
            '/admin/sync/demo-course/start',
            undefined,
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it.each([
        [
            {
                response: {
                    status: 403,
                    data: {
                        code: 'COURSE_SCOPE_FORBIDDEN',
                        reason: 'This course is outside the signed scope.',
                        recovery: 'Choose an authorized course.',
                    },
                },
            },
            'COURSE_SCOPE_FORBIDDEN',
            'This course is outside the signed scope.',
        ],
        [
            { response: { status: 500, data: { reason: 'GradeSync is unavailable.' } } },
            'SYNC_SERVICE_UNAVAILABLE',
            'GradeSync is unavailable.',
        ],
        [
            { code: 'ECONNABORTED', message: 'timeout' },
            'SYNC_TIMEOUT',
            'GradeSync did not respond before the request timed out.',
        ],
    ])('distinguishes a failed staff sync from an empty or successful result', async (failure, code, reason) => {
        setSession();
        const user = userEvent.setup();
        apiv2.post.mockRejectedValue(failure);
        render(<GradeSyncControl />);

        await screen.findByText('2026 Spring Demo Course');
        await user.click(screen.getByRole('button', { name: 'Start Sync for current course' }));

        expect(await screen.findByText(new RegExp(code))).toBeInTheDocument();
        expect(screen.getByText(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
        expect(screen.queryByText('Last Sync Result')).not.toBeInTheDocument();
    });

    it('disables Demo mutation before a network request and explains the API write barrier', async () => {
        setSession({ readOnly: true });
        render(<GradeSyncControl />);

        const start = await screen.findByRole('button', { name: 'Start Sync unavailable in read-only Demo' });
        expect(start).toBeDisabled();
        expect(screen.getByText(/independently rejects Demo writes/i)).toBeInTheDocument();
        expect(apiv2.post).not.toHaveBeenCalled();
    });

    it('aborts a hanging sync request and renders the timeout recovery state', async () => {
        setSession();
        render(<GradeSyncControl />);
        const start = await screen.findByRole('button', { name: 'Start Sync for current course' });
        apiv2.post.mockImplementation((path, body, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const error = new Error('canceled');
                error.code = 'ERR_CANCELED';
                reject(error);
            });
        }));

        jest.useFakeTimers();
        fireEvent.click(start);
        await act(async () => {
            jest.advanceTimersByTime(15000);
            await Promise.resolve();
        });

        expect(screen.getByText(/SYNC_TIMEOUT/)).toBeInTheDocument();
        expect(screen.queryByText('Last Sync Result')).not.toBeInTheDocument();
        jest.useRealTimers();
    });
});
