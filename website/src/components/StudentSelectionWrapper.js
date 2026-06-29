import { createContext, useCallback, useState } from 'react';

export const StudentSelectionContext = createContext({
    selectedStudent: '',
    setSelectedStudent: () => { }
});

export default function StudentSelectionWrapper({ children }) {
    const [selectedStudentValue, setSelectedStudentValue] = useState(
        localStorage.getItem('selectedStudentEmail') || '',
    );

    const setSelectedStudent = useCallback((studentEmail) => {
        const nextStudentEmail = studentEmail || '';
        setSelectedStudentValue(nextStudentEmail);
        if (nextStudentEmail) {
            localStorage.setItem('selectedStudentEmail', nextStudentEmail);
        } else {
            localStorage.removeItem('selectedStudentEmail');
        }
    }, []);

    return (
        <StudentSelectionContext.Provider value={{
            selectedStudent: selectedStudentValue,
            setSelectedStudent,
        }}>
            {children}
        </StudentSelectionContext.Provider>
    )

}
