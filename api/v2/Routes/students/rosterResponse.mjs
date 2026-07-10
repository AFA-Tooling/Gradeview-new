import { enrolledRosterToLegacyPairs } from '../../../lib/courseRoster.mjs';

export function buildStudentsRosterResponse(roster = []) {
    const enrolledRoster = Array.isArray(roster) ? roster : [];
    return {
        rosterSource: 'enrolled_students',
        rosterCount: enrolledRoster.length,
        roster: enrolledRoster,
        students: enrolledRosterToLegacyPairs(enrolledRoster),
    };
}
