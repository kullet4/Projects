import { auth, db } from './firebase-config.js';
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword, signOut as secondarySignOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { onAuthStateChanged, signOut as primarySignOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, deleteDoc, getDocs, query, orderBy, updateDoc, addDoc, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Initialize a secondary Firebase instance purely for creating users, securely bypassing the main Auth state switch
const secondaryApp = initializeApp(firebaseConfig, "SecondaryAppForAdminCreates");
const secondaryAuth = getSecondaryAuth(secondaryApp);

// DOM Elements
const userGreeting = document.getElementById('user-greeting');
const logoutBtn = document.getElementById('logout-btn');

// Edit User Modal Elements
const editUserModal = new bootstrap.Modal(document.getElementById('editUserModal'));
const editUserForm = document.getElementById('edit-user-form');
const editUserId = document.getElementById('edit-user-id');
const editUserGrade = document.getElementById('edit-user-grade');
const editUserSection = document.getElementById('edit-user-section');
const saveUserBtn = document.getElementById('save-user-btn');

// KPI Elements
const kpiUsers = document.getElementById('kpi-users');
const kpiStudents = document.getElementById('kpi-students');
const kpiTeachers = document.getElementById('kpi-teachers');
const kpiModules = document.getElementById('kpi-modules');

// Table Bodys
const usersList = document.getElementById('users-list');
const modulesList = document.getElementById('modules-list');

// Create User Modal Elements
const createUserForm = document.getElementById('create-user-form');
const newRoleSelect = document.getElementById('new-user-role');
const studentOnlyFields = document.getElementById('student-only-fields');

// Handle displaying extra fields in modal based on role
newRoleSelect.addEventListener('change', (e) => {
    if (e.target.value === 'student') {
        studentOnlyFields.classList.remove('d-none');
    } else {
        studentOnlyFields.classList.add('d-none');
    }
});

// Form Submit: Create New User without logging Admin out
createUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('new-user-email').value;
    const pwd = document.getElementById('new-user-pwd').value;
    const name = document.getElementById('new-user-name').value;
    const role = document.getElementById('new-user-role').value;
    
    const errorDiv = document.getElementById('create-user-error');
    const successDiv = document.getElementById('create-user-success');
    const submitBtn = document.getElementById('submit-new-user-btn');

    try {
        errorDiv.classList.add('d-none');
        successDiv.classList.add('d-none');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Creating...';

        // 1. Create Auth entity in SECONDARY app to bypass Auth State Change on the primary app
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, pwd);
        const newUid = userCredential.user.uid;

        // 2. Clear Secondary session immediately so it doesn't stay cached
        await secondarySignOut(secondaryAuth);
        
        // 3. Inject new user into Firestore via primary Admin permissions
        const userData = {
            email: email,
            name: name,
            role: role,
            createdAt: new Date().toISOString()
        };
        
        if(role === 'student') {
            userData.xp = 0;
            userData.completedModules = [];
            userData.gradeLevel = document.getElementById('new-user-grade').value || 'Grade 1';
            userData.section = document.getElementById('new-user-section').value || 'All';
        }
        
        // Write it!
        await setDoc(doc(db, "users", newUid), userData);
        await logAction("USER_CREATED", `Created new ${role.toUpperCase()} account for: ${email}`);
        
        // Let Admin know
        successDiv.classList.remove('d-none');
        createUserForm.reset();
        
        // Reset student-field blocker
        newRoleSelect.value = 'student';
        studentOnlyFields.classList.remove('d-none');

        setTimeout(() => successDiv.classList.add('d-none'), 3000);

    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('d-none');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Create User Account';
    }
});

// Enforce authentication & role
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists() && userDoc.data().role === 'admin') {
                const userData = userDoc.data();
                userGreeting.textContent = `Admin User: ${userData.name || user.email}`;
                
                // Initialize Admin Dashboards
                await loadSystemData();
                document.getElementById('btn-refresh-admin').addEventListener('click', loadSystemData);
            } else {
                // Not an admin
                window.location.href = 'index.html';
            }
        } catch (error) {
            console.error("Error fetching admin data:", error);
            alert("Error validating admin role. Connection problem?");
        }
    } else {
        window.location.href = 'index.html';
    }
});

// Logout Handler
logoutBtn.addEventListener('click', () => {
    primarySignOut(auth).then(() => {
        window.location.href = 'index.html';
    });
});

let barChart = null;
let pieChart = null;
let exportUserData = [];
let exportLogsData = [];

// Initialize Data Streams (Manual fetch to save Firebase Read Costs)
async function loadSystemData() {
    const refreshBtn = document.getElementById('btn-refresh-admin');
    if (refreshBtn) {
        refreshBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
        refreshBtn.disabled = true;
    }

    try {
        // 1. Fetch Users Collection
        const usersQuery = query(collection(db, "users"));
        const usersSnapshot = await getDocs(usersQuery);
        
        let totalUsers = usersSnapshot.size;
        let totalStudents = 0;
        let totalTeachers = 0;
        
        let activeStudents = 0;
        let gradeCounts = { 'Grade 1':0, 'Grade 2':0, 'Grade 3':0, 'Grade 4':0, 'Grade 5':0, 'Grade 6':0 };
        exportUserData = [["Name", "Email", "Role", "Grade", "Section", "XP"]]; // CSV Header
        
        usersList.innerHTML = '';
        
        if(usersSnapshot.empty) {
            usersList.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No users found.</td></tr>`;
        }

        usersSnapshot.forEach((docSnap) => {
            const userData = docSnap.data();
            const id = docSnap.id;
            
            // Tally KPIs
            if(userData.role === 'student') {
                totalStudents++;
                if (userData.xp > 0) activeStudents++;
                if (gradeCounts[userData.gradeLevel] !== undefined) {
                    gradeCounts[userData.gradeLevel]++;
                }
            }
            if(userData.role === 'teacher') totalTeachers++;

            // Prepare CSV Data
            exportUserData.push([
                userData.name || 'Unknown',
                userData.email || 'N/A',
                userData.role || 'N/A',
                userData.gradeLevel || 'N/A',
                userData.section || 'N/A',
                userData.xp || 0
            ]);

            // Render Table Row
            let roleBadge = '';
            let stats = '';
            let actionBtn = `<button class="btn btn-sm btn-outline-secondary" disabled title="No Action Available"><i class="bi bi-slash-circle"></i></button>`;

            if(userData.role === 'admin') {
                roleBadge = `<span class="badge bg-dark">Admin</span>`;
                stats = 'N/A';
            } else if(userData.role === 'teacher') {
                roleBadge = `<span class="badge bg-info text-dark">Teacher</span>`;
                stats = 'Content Creator';
            } else {
                roleBadge = `<span class="badge bg-primary">Student</span>`;
                const gLvl = userData.gradeLevel || 'Grade 1';
                const sec = userData.section || 'All';
                stats = `${userData.xp || 0} XP | ${gLvl}-${sec}`;
                
                // Admin can edit grade/section for student
                actionBtn = `<button class="btn btn-sm btn-outline-primary edit-student-btn" 
                                data-id="${id}" 
                                data-grade="${gLvl}" 
                                data-section="${sec}"
                                title="Edit Grade/Section">
                                <i class="bi bi-pencil-square"></i> Edit
                             </button>`;
            }

            const tr = document.createElement('tr');
            tr.setAttribute('data-role', userData.role || 'unknown');
            tr.innerHTML = `
                <td class="ps-4 fw-medium">${userData.name || userData.email || 'Unknown'}</td>
                <td>${roleBadge}</td>
                <td class="text-muted"><small>${stats}</small></td>
                <td class="text-end pe-4">
                    ${actionBtn}
                </td>
            `;
            usersList.appendChild(tr);
        });

        // Apply current filter after fresh fetch
        const currentFilter = document.getElementById('filter-user-role')?.value || 'all';
        applyUserFilter(currentFilter);

        // Add event listeners for edit buttons
        document.querySelectorAll('.edit-student-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.currentTarget;
                const userId = button.getAttribute('data-id');
                const grade = button.getAttribute('data-grade');
                const section = button.getAttribute('data-section');
                
                editUserId.value = userId;
                editUserGrade.value = grade;
                editUserSection.value = section === 'All' ? '' : section;
                
                editUserModal.show();
            });
        });

        // Update User KPIs
        kpiUsers.textContent = totalUsers;
        kpiStudents.textContent = totalStudents;
        kpiTeachers.textContent = totalTeachers;

        // Render Charts!
        renderCharts(gradeCounts, totalStudents, activeStudents);

        // 2. Fetch Modules Collection (Content Moderation)
        const modulesQuery = query(collection(db, "modules"));
        const modulesSnapshot = await getDocs(modulesQuery);
        
        kpiModules.textContent = modulesSnapshot.size;
        modulesList.innerHTML = '';
        
        if(modulesSnapshot.empty) {
            modulesList.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No modules published yet.</td></tr>`;
        }

        modulesSnapshot.forEach((docSnap) => {
            const modData = docSnap.data();
            const id = docSnap.id;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="ps-4 fw-medium text-truncate" style="max-width: 150px;">${modData.title || 'Untitled'}</td>
                <td class="text-muted"><small>${modData.teacherName || 'Unknown Teacher'}</small></td>
                <td><span class="badge bg-success bg-opacity-75">${modData.xpReward || 0} XP</span></td>
                <td class="text-end pe-4">
                    <button class="btn btn-sm btn-outline-danger delete-module-btn" data-id="${id}" title="Delete Module">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
            modulesList.appendChild(tr);
        });

        // Attach event listeners to dynamically generated delete buttons
        document.querySelectorAll('.delete-module-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const moduleId = e.currentTarget.getAttribute('data-id');
                await deleteModule(moduleId);
            });
        });
        
        // 3. Fetch System Audit Logs
        await loadAuditLogs();

    } catch (error) {
        console.error("Error loading system data:", error);
        usersList.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Failed to fetch data securely.</td></tr>`;
    } finally {
        if (refreshBtn) {
            refreshBtn.innerHTML = `<i class="bi bi-arrow-clockwise"></i> Refresh`;
            refreshBtn.disabled = false;
        }
    }
}

// ===== PHASE 1: ADMIN ANALYTICS & LOGGING =================

// Handle User Role Filtering (Client-side)
document.getElementById('filter-user-role')?.addEventListener('change', (e) => {
    applyUserFilter(e.target.value);
});

function applyUserFilter(role) {
    document.querySelectorAll('#users-list tr[data-role]').forEach(row => {
        if (role === 'all' || row.getAttribute('data-role') === role) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Utility to write to System Audit Logs
export async function logAction(actionType, details, actor) {
    try {
        await addDoc(collection(db, "system_logs"), {
            actionType,
            details,
            actor: actor || auth.currentUser?.email || 'Unknown',
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Failed to write log", error);
    }
}

// Fetch and display System Audit Logs
async function loadAuditLogs() {
    const logsList = document.getElementById('audit-logs-list');
    exportLogsData = [["Timestamp", "Action", "Actor", "Details"]]; // Reset CSV

    try {
        const logsQuery = query(collection(db, "system_logs"), orderBy("timestamp", "desc"), limit(50));
        const logsSnapshot = await getDocs(logsQuery);
        
        logsList.innerHTML = '';

        if(logsSnapshot.empty) {
            logsList.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No system activity logged yet.</td></tr>`;
            return;
        }

        logsSnapshot.forEach(docSnap => {
            const l = docSnap.data();
            const date = l.timestamp ? l.timestamp.toDate().toLocaleString() : 'Just now';
            
            // Add to CSV
            exportLogsData.push([date, l.actionType, l.actor, l.details]);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-muted" style="font-size: 0.85rem;">${date}</td>
                <td><span class="badge bg-secondary">${l.actionType}</span></td>
                <td class="fw-medium">${l.actor}</td>
                <td class="text-truncate" style="max-width: 250px;">${l.details}</td>
            `;
            logsList.appendChild(tr);
        });

    } catch (error) {
        console.error("Error loading logs", error);
        logsList.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Failed to fetch logs.</td></tr>`;
    }
}

// Render Chart.js Analytics
function renderCharts(gradeCounts, totalStudents, activeStudents) {
    // Destroy previous charts if they exist so they don't overlap on refresh
    if(barChart) barChart.destroy();
    if(pieChart) pieChart.destroy();

    // Bar Chart: Students per Grade
    const barCtx = document.getElementById('barChart').getContext('2d');
    barChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: Object.keys(gradeCounts),
            datasets: [{
                label: 'Enrolled Students',
                data: Object.values(gradeCounts),
                backgroundColor: 'rgba(13, 110, 253, 0.7)',
                borderColor: 'rgba(13, 110, 253, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });

    // Pie Chart: Active vs Inactive Students
    const pieCtx = document.getElementById('pieChart').getContext('2d');
    let inactive = totalStudents - activeStudents;
    pieChart = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
            labels: ['Started/Finished Module (Active)', 'Not Started (Inactive)'],
            datasets: [{
                data: [activeStudents, inactive],
                backgroundColor: ['rgba(25, 135, 84, 0.7)', 'rgba(220, 53, 69, 0.7)'],
                borderColor: ['rgba(25, 135, 84, 1)', 'rgba(220, 53, 69, 1)'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

// CSV Export Utility
function downloadCSV(csvArray, filename) {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvArray.forEach(rowArray => {
        let row = rowArray.map(item => `"${String(item).replace(/"/g, '""')}"`).join(",");
        csvContent += row + "\r\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

document.getElementById('btn-export-csv').addEventListener('click', () => {
    if(exportUserData.length > 1) {
        downloadCSV(exportUserData, `ELMS_Users_${new Date().toISOString().slice(0,10)}.csv`);
        logAction("DATA_EXPORT", "Admin exported User list to CSV");
    } else {
        alert("No user data available to export.");
    }
});

document.getElementById('btn-export-logs')?.addEventListener('click', () => {
    if(exportLogsData.length > 1) {
        downloadCSV(exportLogsData, `ELMS_Logs_${new Date().toISOString().slice(0,10)}.csv`);
        logAction("DATA_EXPORT", "Admin exported Audit Logs down to CSV");
    } else {
        alert("No logs available to export.");
    }
});

// Handle Saving Edited Student Info
editUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = editUserId.value;
    const gradeLevel = editUserGrade.value;
    const section = editUserSection.value || 'All';
    
    try {
        saveUserBtn.disabled = true;
        saveUserBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
        
        await updateDoc(doc(db, "users", userId), {
            gradeLevel: gradeLevel,
            section: section
        });
        
        editUserModal.hide();
        await loadSystemData();
        await logAction("STUDENT_EDITED", `Admin changed grade/section placement for student ID: ${userId}`);
    } catch (error) {
        console.error("Error updating user:", error);
        alert('Failed to update student info.');
    } finally {
        saveUserBtn.disabled = false;
        saveUserBtn.innerHTML = 'Save Changes';
    }
});
async function deleteModule(moduleId) {
    if(confirm("Are you sure you want to permanently delete this instructional material? This cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "modules", moduleId));
            await logAction("MODULE_DELETED", `Admin deleted instructional module ID: ${moduleId}`);
            // Re-fetch the data to reflect deletion
            await loadSystemData();
        } catch (error) {
            console.error("Error deleting module:", error);
            alert("Failed to delete module.");
        }
    }
}
