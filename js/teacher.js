import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { onSnapshot, arrayUnion, orderBy, limit, doc, getDoc, setDoc, updateDoc, collection, addDoc, serverTimestamp, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js";

// DOM Elements
const userGreeting = document.getElementById('user-greeting');
const logoutBtn = document.getElementById('logout-btn');
const createModuleForm = document.getElementById('create-module-form');
const moduleAlert = document.getElementById('module-alert');
const moduleImageInput = document.getElementById('module-image');
const modulePdfUrlInput = document.getElementById('module-pdf-url');
const studentListId = document.getElementById('student-monitoring-list');
const studentCountBadge = document.getElementById('student-count');

// New Quiz/Grading UI Elements
const btnAddQuestion = document.getElementById('btn-add-question');
const quizBuilderContainer = document.getElementById('quiz-builder-container');
let questionCount = 0;

// Analytics Modal Elements
const sdModalEl = document.getElementById('studentDetailsModal');
const sdModal = sdModalEl ? new bootstrap.Modal(sdModalEl) : null;

// Filters to reduce Firebase read costs
const filterGrade = document.getElementById('filter-grade');
const filterSection = document.getElementById('filter-section');
const btnLoadStudents = document.getElementById('btn-load-students');

let currentUserDoc = null;
const storage = getStorage();

async function uploadModuleImage(file) {
    const safeName = file.name.replace(/\s+/g, '_');
    const filePath = `module_images/${auth.currentUser.uid}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, filePath);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
}

function sanitizePdfUrl(rawUrl) {
    if (!rawUrl) return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    const isHttp = /^https?:\/\//i.test(trimmed);
    const looksLikePdf = /\.pdf(\?|#|$)/i.test(trimmed);
    const isDrivePreview = /^https?:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+\/(preview|view)/i.test(trimmed);
    const isDriveDirect = /^https?:\/\/drive\.google\.com\/uc\?(?:[^#]*&)?export=download&(?:[^#]*&)?id=[a-zA-Z0-9_-]+/i.test(trimmed)
        || /^https?:\/\/drive\.google\.com\/uc\?(?:[^#]*&)?id=[a-zA-Z0-9_-]+&(?:[^#]*&)?export=download/i.test(trimmed);
    return isHttp && (looksLikePdf || isDrivePreview || isDriveDirect) ? trimmed : null;
}

// Enforce authentication & role
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists() && userDoc.data().role === 'teacher') {
                currentUserDoc = userDoc.data();
                const teacherName = currentUserDoc.name || 'User';
                userGreeting.textContent = teacherName; // Simple top right name
                
                const mainGreetingName = document.getElementById('main-greeting-name');
                if(mainGreetingName) mainGreetingName.textContent = teacherName.split(' ')[0]; // Big Gemini style "Hi [Name]"
                
                // Initialize student load
                await loadStudentData();
                listenForNotifications("teacher");
                btnLoadStudents.addEventListener('click', loadStudentData);

            } else {
                // Not a teacher
                window.location.href = 'index.html';
            }
        } catch (error) {
            console.error("Error fetching teacher data:", error);
            alert("Error loading dashboard data.");
        }
    } else {
        window.location.href = 'index.html';
    }
});

// Auto-resize textareas for better mobile UX
const textareas = document.querySelectorAll('textarea');
textareas.forEach(textarea => {
    textarea.addEventListener('input', function() {
        this.style.height = 'auto'; // Reset the height
        this.style.height = (this.scrollHeight) + 'px'; // Set it to the scroll height
    });
});

let classCompletionChart = null;

// Quiz Builder Dynamic UI
if(btnAddQuestion) {
    btnAddQuestion.addEventListener('click', () => {
        questionCount++;
        const qDiv = document.createElement('div');
        qDiv.className = 'quiz-q-card mb-3';
        qDiv.innerHTML = `
            <div class="quiz-q-header py-2 px-3 d-flex justify-content-between align-items-center">
                <span class="text-primary"><i class="bi bi-question-circle"></i> Question ${questionCount}</span>
                <button type="button" class="btn-close btn-sm remove-q"></button>
            </div>
            <div class="card-body p-3">
                <input type="text" class="form-control border-primary mb-3 q-text fw-bold text-dark" placeholder="Type your question here..." required>
                <div class="row g-2 mb-3">
                    <div class="col-6"><input type="text" class="form-control rounded-pill q-opt shadow-sm" placeholder="Option A" required></div>
                    <div class="col-6"><input type="text" class="form-control rounded-pill q-opt shadow-sm" placeholder="Option B" required></div>
                    <div class="col-6"><input type="text" class="form-control rounded-pill q-opt shadow-sm" placeholder="Option C" required></div>
                    <div class="col-6"><input type="text" class="form-control rounded-pill q-opt shadow-sm" placeholder="Option D" required></div>
                </div>
                <select class="form-select border-success bg-light q-ans fw-bold text-success rounded-pill" required>
                    <option value="" disabled selected>Mark Correct Answer...</option>
                    <option value="0">Option A is correct</option>
                    <option value="1">Option B is correct</option>
                    <option value="2">Option C is correct</option>
                    <option value="3">Option D is correct</option>
                </select>
            </div>
        `;
        qDiv.querySelector('.remove-q').addEventListener('click', () => qDiv.remove());
        quizBuilderContainer.appendChild(qDiv);
    });
}

// 1. Create purely Reading Material (No Grade, Just XP)
createModuleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('module-title').value;
    const desc = document.getElementById('module-desc').value;
    const contentText = document.getElementById('module-content').value;
    const gradeLevel = document.getElementById('module-grade').value;
    const section = document.getElementById('module-section').value || 'All';
    const subject = document.getElementById('module-subject').value;
    const xp = parseInt(document.getElementById('module-xp').value, 10);
    const submitBtn = createModuleForm.querySelector('button[type="submit"]');
    const imageFile = moduleImageInput && moduleImageInput.files ? moduleImageInput.files[0] : null;
    const parsedPdfUrl = sanitizePdfUrl(modulePdfUrlInput ? modulePdfUrlInput.value : '');

    if (parsedPdfUrl === null) {
        alert("Please enter a valid public PDF URL (.pdf) or a valid Google Drive file link.");
        return;
    }

    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Publishing...`;

        let imageUrl = '';
        if (imageFile) {
            submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Uploading image...`;
            imageUrl = await uploadModuleImage(imageFile);
            submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Publishing...`;
        }

        await addDoc(collection(db, "modules"), {
            type: 'reading',
            title: title,
            description: desc,
            content: contentText,
            imageUrl: imageUrl,
            pdfUrl: parsedPdfUrl || '',
            targetGrade: gradeLevel,
            targetSection: section,
            subject: subject,
            gradingCategory: 'none',  
            xpReward: xp,
            teacherId: auth.currentUser.uid,
            teacherName: currentUserDoc.name || 'Instructor',
            createdAt: serverTimestamp(),
            status: 'active'
        });

        moduleAlert.classList.remove('d-none');
        createModuleForm.reset();
        setTimeout(() => moduleAlert.classList.add('d-none'), 4000);

    } catch (error) {
        console.error("Error adding reading module: ", error);
        alert("Failed to publish reading material. You may be offline.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Publish Reading`;
    }
});

// 2. Create purely Quiz Material (Graded + XP)
const createQuizForm = document.getElementById('create-quiz-form');
const quizAlert = document.getElementById('quiz-alert');

if(createQuizForm) {
    createQuizForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const title = document.getElementById('quiz-title').value;
        const desc = document.getElementById('quiz-desc').value;
        const gradeLevel = document.getElementById('quiz-grade').value;
        const section = document.getElementById('quiz-section').value || 'All';
        const subject = document.getElementById('quiz-subject').value;
        const gradingType = document.getElementById('quiz-grading-type').value;
        const expectedMaxScore = parseInt(document.getElementById('quiz-max-score').value, 10);
        const xp = parseInt(document.getElementById('quiz-xp').value, 10);
        const submitBtn = createQuizForm.querySelector('button[type="submit"]');

        // Gather Questions
        const questions = [];
        const answerKey = [];
        document.querySelectorAll('#quiz-builder-container .quiz-q-card').forEach(card => {
            const question = card.querySelector('.q-text').value;
            const options = Array.from(card.querySelectorAll('.q-opt')).map(i => i.value);
            const correctIndex = parseInt(card.querySelector('.q-ans').value, 10);
            questions.push({
                question,
                options
            });
            answerKey.push(correctIndex);
        });

        if (questions.length === 0) {
            alert("Please add at least one question to the quiz.");
            return;
        }

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Publishing...`;

            const moduleRef = await addDoc(collection(db, "modules"), {
                type: 'quiz',
                title: title,
                description: desc,
                targetGrade: gradeLevel,
                targetSection: section,
                subject: subject,
                gradingCategory: gradingType,  // 'ww', 'pt', 'qa', 'none'
                questions: questions,          // Student-facing questions without answer key
                maxScore: expectedMaxScore || questions.length,    // Updated to use the custom expected grade set by teacher
                xpReward: xp,
                teacherId: auth.currentUser.uid,
                teacherName: currentUserDoc.name || 'Instructor',
                createdAt: serverTimestamp(),
                status: 'active'
            });

            // Keep answer keys outside student-readable module docs.
            await setDoc(doc(db, "quiz_keys", moduleRef.id), {
                moduleId: moduleRef.id,
                answers: answerKey,
                createdAt: serverTimestamp(),
                teacherId: auth.currentUser.uid
            });

            quizAlert.classList.remove('d-none');
            createQuizForm.reset();
            if(quizBuilderContainer) quizBuilderContainer.innerHTML = '';
            questionCount = 0;
            setTimeout(() => quizAlert.classList.add('d-none'), 4000);

        } catch (error) {
            console.error("Error adding quiz: ", error);
            alert("Failed to publish quiz.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `Publish Quiz`;
        }
    });
}

// Fetch Student Progress (Manual fetch to save Firebase Read Costs)
async function loadStudentData() {
    try {
        if(btnLoadStudents) {
            btnLoadStudents.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`;
            btnLoadStudents.disabled = true;
        }

        studentListId.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Fetching classroom data...</td></tr>`;

        // Base query for students
        let conditions = [where("role", "==", "student")];
        
        // Add optional filters to limit costs to a specific classroom
        if (filterGrade && filterGrade.value) {
            conditions.push(where("gradeLevel", "==", filterGrade.value));
        }
        if (filterSection && filterSection.value) {
            conditions.push(where("section", "==", filterSection.value));
        }

        const q = query(collection(db, "users"), ...conditions);
        const snapshot = await getDocs(q);

        studentListId.innerHTML = ''; 
        studentCountBadge.textContent = snapshot.size;

        if (snapshot.empty) {
            studentListId.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No students found matching these filters.</td></tr>`;
            renderTeacherChart(0, 0); // No data
            return;
        }

        let activeCount = 0;
        let inactiveCount = 0;

        snapshot.forEach((docSnap) => {
            const studentData = docSnap.data();
            const xp = studentData.xp || 0;
            const gLvl = studentData.gradeLevel || 'Unknown';
            const sec = studentData.section || 'N/A';
            
            if (xp > 0) activeCount++;
            else inactiveCount++;

            // Ensure student has a default scores object and DepEd rating track
            const scores = studentData.scores || { wwRaw: 0, wwMax: 100, ptRaw: 0, ptMax: 100, qaRaw: 0, qaMax: 100 };
            const trackStr = studentData.track || 'LANGUAGE_AP_ESP'; 
            const weightTrack = window.DEPED_WEIGHTS[trackStr] || window.DEPED_WEIGHTS.LANGUAGE_AP_ESP;

            // Compute Transmuted Grade Client-Side via ZERO Reads
            const gradeResult = window.DepEdGrader.calculateGrade(scores, weightTrack);
            let gradeBadgeClass = 'bg-secondary';
            if (gradeResult.transmutedGrade >= 90) gradeBadgeClass = 'bg-success';
            else if (gradeResult.transmutedGrade >= 80) gradeBadgeClass = 'bg-primary';
            else if (gradeResult.transmutedGrade >= 75) gradeBadgeClass = 'bg-warning text-dark';
            else gradeBadgeClass = 'bg-danger';

            let statusBadge = '';
            if (xp === 0) {
                statusBadge = `<span class="badge bg-secondary">Not Started</span>`;
            } else if (xp > 0 && xp < 500) {
                statusBadge = `<span class="badge bg-warning text-dark">In Progress</span>`;
            } else {
                statusBadge = `<span class="badge bg-success">Excelling</span>`;
            }

            const tr = document.createElement('tr');
            tr.className = "student-analytics-row"; // Added for easy DOM querying
            const studentName = studentData.name || studentData.email || 'Anonymous Student';
            
            // Set DATA attributes for quick client-side filtering without pinging Firebase
            tr.setAttribute('data-name', studentName.toLowerCase());
            tr.setAttribute('data-grade', gLvl);
            tr.setAttribute('data-section', sec);
            tr.setAttribute('data-active', xp > 0 ? "true" : "false");

            tr.innerHTML = `
                <td class="ps-4 fw-medium">${studentName}</td>
                <td class="text-muted"><small>${gLvl} - ${sec}</small></td>
                <td><i class="bi bi-star-fill text-warning"></i> ${xp}</td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge ${gradeBadgeClass} rounded-pill fs-6">${gradeResult.transmutedGrade}%</span>
                        <small class="text-muted text-truncate" style="max-width: 100px;" title="${gradeResult.descriptor}">${gradeResult.descriptor}</small>
                    </div>
                    <div class="progress mt-1" style="height: 4px;" title="Initial Grade: ${gradeResult.initialGrade}">
                        <div class="progress-bar ${gradeBadgeClass.split(' ')[0]}" role="progressbar" style="width: ${gradeResult.transmutedGrade}%" aria-valuenow="${gradeResult.transmutedGrade}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td class="text-end pe-4">
                    <button class="btn btn-sm btn-outline-primary btn-view-details" aria-label="View Details">
                        <i class="bi bi-search"></i>
                    </button>
                </td>
            `;
            
            // Attach event listener for Deeper Analytics Modal
            const viewBtn = tr.querySelector('.btn-view-details');
            viewBtn.addEventListener('click', () => {
                document.getElementById('sd-modal-name').textContent = studentData.name || studentData.email || 'Anonymous Student';
                document.getElementById('sd-modal-info').textContent = `${gLvl} - ${sec} | Track: ${trackStr.replace(/_/g, ' ')}`;
                document.getElementById('sd-modal-xp').textContent = xp;
                document.getElementById('sd-modal-grade').textContent = gradeResult.transmutedGrade + '%';
                
                const listEl = document.getElementById('sd-modal-completed-list');
                listEl.innerHTML = '';
                
                const completedMods = studentData.completedModules || [];
                if (completedMods.length === 0) {
                    listEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">No activities completed yet.</td></tr>`;
                } else {
                    // Loop backwards so newest activities are on top
                    completedMods.slice().reverse().forEach(mod => {
                        const modData = (mod && typeof mod === 'object')
                            ? mod
                            : {
                                moduleId: typeof mod === 'string' ? mod : '',
                                title: typeof mod === 'string' ? `Legacy Activity (${mod})` : 'Legacy Activity',
                                gradingCategory: 'none',
                                score: 0,
                                maxScore: 0,
                                isLegacy: true
                            };

                        const modType = modData.gradingCategory && modData.gradingCategory !== 'none' 
                            ? modData.gradingCategory.toUpperCase() 
                            : 'PRACTICE';
                        
                        let badgeColor = modType === 'PRACTICE' ? 'bg-secondary' : 'bg-primary';
                            
                        const scoreTxt = (modData.maxScore && modData.maxScore > 0) 
                            ? `${modData.score || 0}/${modData.maxScore}` 
                            : `<i class="bi bi-check-circle-fill text-success"></i>`;
                            
                        const actionBtn = (!modData.isLegacy && modData.maxScore && modData.maxScore > 0) 
                            ? `<button class="btn btn-sm btn-outline-warning text-dark px-2 py-0 fw-bold border-2 shadow-sm"
                                       title="Override Score"
                                       onclick="window.openGradeEditor('${docSnap.id}', '${modData.moduleId}', '${modData.title || 'Unknown Activity'}', ${modData.score || 0}, ${modData.maxScore})">
                                   <i class="bi bi-pencil-square"></i> Edit
                               </button>`
                            : `<span class="text-muted small">N/A</span>`;

                        listEl.innerHTML += `
                            <tr>
                                <td class="fw-medium text-dark">${modData.title || 'Unknown Activity'}</td>
                                <td><span class="badge ${badgeColor}">${modType}</span></td>
                                <td class="text-center fw-bold text-success">${scoreTxt}</td>
                                <td class="text-end">${actionBtn}</td>
                            </tr>
                        `;
                    });
                }
                
                if(sdModal) sdModal.show();
            });

            studentListId.appendChild(tr);
        });

        // Finally, render the Completion chart
        renderTeacherChart(activeCount, inactiveCount);

    } catch (error) {
        console.error("Error fetching students: ", error);
        studentListId.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Failed to load data. Please try again.</td></tr>`;
        renderTeacherChart(0, 0); // No data
    } finally {
        if(btnLoadStudents) {
            btnLoadStudents.innerHTML = `<i class="bi bi-arrow-clockwise"></i> Load`;
            btnLoadStudents.disabled = false;
        }
    }
}

// Client-Side Filtering for Pie Chart & Table View 
// (Zero Firebase Reads + Instant speed)
function applyLocalFilters() {
    const fName = document.getElementById('localFilterName')?.value.toLowerCase() || '';
    const fGrade = document.getElementById('localFilterGrade')?.value || '';
    const fSection = document.getElementById('localFilterSection')?.value || '';
    
    const rows = document.querySelectorAll('.student-analytics-row');
    let visibleActive = 0;
    let visibleInactive = 0;

    rows.forEach(row => {
        const rName = row.getAttribute('data-name');
        const rGrade = row.getAttribute('data-grade');
        const rSection = row.getAttribute('data-section');
        const rActive = row.getAttribute('data-active') === "true";
        
        const matchName = rName.includes(fName);
        const matchGrade = fGrade === '' || rGrade === fGrade;
        const matchSection = fSection === '' || rSection === fSection;

        if (matchName && matchGrade && matchSection) {
            row.style.display = '';
            if (rActive) visibleActive++;
            else visibleInactive++;
        } else {
            row.style.display = 'none';
        }
    });

    renderTeacherChart(visibleActive, visibleInactive);
}

document.getElementById('localFilterName')?.addEventListener('input', applyLocalFilters);
document.getElementById('localFilterGrade')?.addEventListener('change', applyLocalFilters);
document.getElementById('localFilterSection')?.addEventListener('change', applyLocalFilters);

// Chart.js Teacher Stats Render
function renderTeacherChart(active, inactive) {
    const total = active + inactive;
    const rate = total > 0 ? Math.round((active / total) * 100) : 0;
    const statText = document.getElementById('chart-stat-active');
    
    if(statText) {
        statText.textContent = rate + '%';
        statText.className = rate >= 75 ? 'mb-0 fw-bold text-success display-6' : (rate >= 50 ? 'mb-0 fw-bold text-warning  display-6' : 'mb-0 fw-bold text-danger  display-6');
    }

    const ctx = document.getElementById('teacherClassChart');
    if (!ctx) return;

    if (classCompletionChart) {
        classCompletionChart.destroy();
    }

    // Determine colors
    const activeColor = rate >= 75 ? '#198754' : (rate >= 50 ? '#ffc107' : '#dc3545');

    classCompletionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Started Coursework', 'Not Started'],
            datasets: [{
                data: [active, inactive],
                backgroundColor: [activeColor, '#e9ecef'],
                borderColor: ['#fff', '#fff'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%', // makes it a nice thin ring
            plugins: {
                legend: { 
                    display: true, 
                    position: 'right',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ' ' + context.label + ': ' + context.raw + ' student(s)';
                        }
                    }
                }
            }
        }
    });
}

// Logout Handler
logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.href = 'index.html';
    });
});

// ==========================================
// MANUAL GRADING SYSTEM (TEACHER OVERRIDE)
// ==========================================
const manualGradeModalEl = document.getElementById('manualGradeModal');
const manualGradeModal = manualGradeModalEl ? new bootstrap.Modal(manualGradeModalEl) : null;
const manualGradeForm = document.getElementById('manual-grade-form');

window.openGradeEditor = (studentId, moduleId, moduleName, currentScore, maxScore) => {
    document.getElementById('grade-student-id').value = studentId;
    document.getElementById('grade-module-id').value = moduleId;
    document.getElementById('grade-module-name').textContent = moduleName;
    document.getElementById('grade-new-score').value = currentScore;
    document.getElementById('grade-new-score').max = maxScore;
    document.getElementById('grade-max-score').value = maxScore;
    document.getElementById('grade-max-label').textContent = `/ ${maxScore}`;
    
    if (manualGradeModal) {
        // Hide the main details modal briefly so they don't overlap awkwardly
        if (sdModal) sdModal.hide();
        manualGradeModal.show();
    }
};

if (manualGradeForm) {
    manualGradeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const saveBtn = document.getElementById('btn-save-grade');
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving...`;

        const sId = document.getElementById('grade-student-id').value;
        const mId = document.getElementById('grade-module-id').value;
        const newScore = parseInt(document.getElementById('grade-new-score').value, 10);
        
        try {
            const studentRef = doc(db, 'users', sId);
            const studentSnap = await getDoc(studentRef);
            
            if (studentSnap.exists()) {
                const data = studentSnap.data();
                const completedMods = data.completedModules || [];
                const scores = data.scores || { wwRaw: 0, wwMax: 100, ptRaw: 0, ptMax: 100, qaRaw: 0, qaMax: 100 };
                
                let foundMod = completedMods.find(m => m && typeof m === 'object' && m.moduleId === mId);
                
                if (foundMod) {
                    const oldScore = foundMod.score || 0;
                    const cat = foundMod.gradingCategory || 'ww';
                    
                    // Deduct old score and add new score to raw totals
                    if (cat === 'ww') scores.wwRaw = Math.max(0, scores.wwRaw - oldScore + newScore);
                    else if (cat === 'pt') scores.ptRaw = Math.max(0, scores.ptRaw - oldScore + newScore);
                    else if (cat === 'qa') scores.qaRaw = Math.max(0, scores.qaRaw - oldScore + newScore);

                    // Update the specific module score
                    foundMod.score = newScore;
                    
                    // Push to Firebase
                    await updateDoc(studentRef, {
                        completedModules: completedMods,
                        scores: scores
                    });
                    
                    alert("Grade updated successfully!");
                    manualGradeModal.hide();
                    
                    // Reload table to reflect new data
                    await loadStudentData();
                } else {
                    alert("Module not found in student's completed list.");
                }
            }
        } catch (err) {
            console.error("Error updating grade: ", err);
            alert("Error saving grade.");
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `Save Grade`;
        }
    });
    
    // When Grade Modal closes, you might want to re-open the Student Details modal? Let's leave that optional.
    manualGradeModalEl.addEventListener('hidden.bs.modal', () => {
        // Optional: Re-open sdModal
    });
}

// ===== Manage Teacher Modules & Audit Logging =====
async function logTeacherAction(actionType, details) {
    try {
        await addDoc(collection(db, "system_logs"), {
            actionType,
            details,
            actor: currentUserDoc?.name || auth.currentUser?.email || 'Teacher',
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Failed to write log", error);
    }
}

const btnLoadMyModules = document.getElementById('btn-load-my-modules');
const myModulesList = document.getElementById('my-modules-list');

if (btnLoadMyModules) {
    btnLoadMyModules.addEventListener('click', async () => {
        myModulesList.innerHTML = `<tr><td colspan="4" class="text-center text-primary"><div class="spinner-border spinner-border-sm"></div> Loading...</td></tr>`;
        
        try {
            const q = query(
                collection(db, "modules"), 
                where("teacherId", "==", auth.currentUser.uid)
            );
            const snapshot = await getDocs(q);
            
            myModulesList.innerHTML = '';
            
            if (snapshot.empty) {
                myModulesList.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">You haven't created any modules yet.</td></tr>`;
                return;
            }

            const mods = [];
            snapshot.forEach(docSnap => {
                mods.push({ id: docSnap.id, ...docSnap.data() });
            });

            // Sort by creation date descending client-side to save on compound indexing cost initially
            mods.sort((a,b) => {
                const tA = a.createdAt?.seconds || 0;
                const tB = b.createdAt?.seconds || 0;
                return tB - tA;
            });

            mods.forEach((m, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="fw-bold text-dark">${m.title}</td>
                    <td><span class="badge ${m.type === 'quiz' ? 'bg-warning text-dark' : 'bg-info text-dark'} text-uppercase">${m.type}</span></td>
                    <td><small class="text-muted">${m.targetGrade} / ${m.targetSection}</small></td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-info btn-view-module me-1" data-index="${idx}" title="Preview Lesson">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger btn-delete-module" data-id="${m.id}" data-title="${m.title}" title="Delete Lesson">
                            <i class="bi bi-trash3-fill"></i>
                        </button>
                    </td>
                `;
                myModulesList.appendChild(tr);
            });

            // Attach View Handlers
            document.querySelectorAll('.btn-view-module').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = e.currentTarget.getAttribute('data-index');
                    const mod = mods[idx];

                    document.getElementById('viewModuleTitle').textContent = mod.title;
                    document.getElementById('viewModuleType').textContent = mod.type === 'reading' ? '📖 Reading' : '🧩 Quiz';
                    document.getElementById('viewModuleType').className = mod.type === 'quiz' ? 'badge bg-warning text-dark' : 'badge bg-info text-dark';
                    
                    document.getElementById('viewModuleTarget').textContent = `${mod.targetGrade} | ${mod.targetSection}`;
                    document.getElementById('viewModuleSubject').textContent = mod.subject || "General";
                    document.getElementById('viewModuleGrading').textContent = `Grading: ${mod.gradingCategory === 'none' ? 'Practice' : mod.gradingCategory.toUpperCase()}`;
                    
                    document.getElementById('viewModuleDesc').textContent = mod.description || "No description provided.";
                    
                    const contentArea = document.getElementById('viewModuleContentArea');
                    if (mod.type === 'reading') {
                        contentArea.innerHTML = `
                            <p class="fw-bold text-primary mb-2"><i class="bi bi-book"></i> Lesson Content:</p>
                            ${mod.imageUrl ? `<img src="${mod.imageUrl}" alt="Module image" class="img-fluid rounded border shadow-sm mb-3">` : ''}
                            ${mod.pdfUrl ? `<div class="mb-3"><a href="${mod.pdfUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary fw-bold"><i class="bi bi-file-earmark-pdf"></i> Open PDF</a></div>` : ''}
                            <div class="bg-white border p-3 rounded shadow-sm text-dark lh-lg" style="white-space: pre-wrap;">${mod.content || "Content missing."}</div>
                        `;
                    } else if (mod.type === 'quiz') {
                        let qHtml = `<p class="fw-bold text-primary mb-2"><i class="bi bi-list-check"></i> Questions (Max points: ${mod.maxScore}):</p><div class="list-group">`;
                        if(mod.questions && Array.isArray(mod.questions)) {
                            mod.questions.forEach((q, i) => {
                                qHtml += `<div class="list-group-item bg-white border mb-2 rounded shadow-sm">
                                            <h6 class="fw-bold mb-2">Q${i+1}. ${q.question}</h6>
                                            <div class="ms-3 d-flex flex-column gap-1">`;
                                q.options.forEach((opt) => {
                                    qHtml += `<div class="p-2 border rounded bg-light">${opt}</div>`;
                                });
                                qHtml += `</div></div>`;
                            });
                            qHtml += `<p class="text-muted mt-2 mb-0"><small>Answer key is stored securely and not exposed to students.</small></p>`;
                        } else {
                            qHtml += `<p class="text-muted">No questions found.</p>`;
                        }
                        qHtml += `</div>`;
                        contentArea.innerHTML = qHtml;
                    }

                    const viewModal = new bootstrap.Modal(document.getElementById('viewModuleModal'));
                    viewModal.show();
                });
            });

            // Attach Delete Handlers
            document.querySelectorAll('.btn-delete-module').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const modId = e.currentTarget.getAttribute('data-id');
                    const modTitle = e.currentTarget.getAttribute('data-title');
                    
                    if (confirm(`Are you sure you want to permanently delete "${modTitle}"?\nThis cannot be undone.`)) {
                        const targetBtn = e.currentTarget;
                        const rowToRemove = targetBtn.closest('tr');
                        targetBtn.disabled = true;
                        targetBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
                        try {
                            await deleteDoc(doc(db, "modules", modId));
                            await deleteDoc(doc(db, "quiz_keys", modId)).catch(() => {});
                            await logTeacherAction("MODULE_DELETED", `Teacher deleted module: ${modTitle} (${modId})`);
                            rowToRemove.style.opacity = '0.5';
                            rowToRemove.innerHTML = `<td colspan="4" class="text-center text-danger"><i class="bi bi-check-circle"></i> Deleted</td>`;
                            setTimeout(() => rowToRemove.remove(), 1500);
                        } catch (err) {
                            console.error("Error deleting module:", err);
                            alert("Failed to delete module. Check console.");
                            targetBtn.disabled = false;
                            targetBtn.innerHTML = `<i class="bi bi-trash3-fill"></i>`;
                        }
                    }
                });
            });

        } catch (error) {
            console.error("Error loading modules", error);
            myModulesList.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-4">Failed to load modules securely.</td></tr>`;
        }
    });
}
// --- NOTIFICATION SYSTEM ---
function showToast(title, message, isAlert = false) {
    const toastContainer = document.getElementById('toastPlacement');
    if(!toastContainer) return;

    const toastEl = document.createElement('div');
    toastEl.className = `toast ${isAlert ? 'bg-danger text-white' : 'bg-success text-white'} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
      <div class="toast-header ${isAlert ? 'bg-danger text-white border-light' : 'bg-success text-white border-light'}">
        <i class="bi ${isAlert ? 'bi-exclamation-circle-fill' : 'bi-bell-fill'} me-2"></i>
        <strong class="me-auto">${title}</strong>
        <small>Just now</small>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
      <div class="toast-body">
        ${message}
      </div>
    `;

    toastContainer.appendChild(toastEl);
    const toastInstance = new bootstrap.Toast(toastEl, { delay: 5000 });
    toastInstance.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

function listenForNotifications(role = "student", gradeLvl = null) {
    let conditions = [];
    if(role === "teacher") {
        conditions = [where("type", "==", "submission")];
    } else {
        conditions = [
            where("type", "==", "new_module")
        ];
        // student section could be added here, but keep it broad per grade for now
        if(gradeLvl) conditions.push(where("targetGrade", "==", gradeLvl));
    }

    // Notice we use the imported functions from firebase-firestore.js explicitly mapped at the top
    // query, collection, db, where, orderBy, limit, onSnapshot are needed
    const q = query(collection(db, "notifications"), ...conditions, limit(20));
    
    // Using tracking to prevent initial load from firing toasts
    let isInitialLoad = true;

    onSnapshot(q, (snapshot) => {
        const notificationList = document.getElementById('notification-list');
        const notifBadge = document.getElementById('notif-badge');
        if(!notificationList || !notifBadge) return;
        
        let newCount = 0;
        let html = `<li><h6 class="dropdown-header">Notifications</h6></li><li><hr class="dropdown-divider"></li>`;
        
        if(snapshot.empty) {
            html += `<li><a class="dropdown-item text-muted text-center py-3" href="#">No new notifications</a></li>`;
        } else {
            // Sort client-side to avoid Firestore composite index requirement
            let docs = [];
            snapshot.forEach(docSnap => docs.push({ id: docSnap.id, data: docSnap.data() }));
            docs.sort((a, b) => {
                let timeA = a.data.timestamp ? (a.data.timestamp.toDate ? a.data.timestamp.toDate().getTime() : new Date(a.data.timestamp).getTime()) : 0;
                let timeB = b.data.timestamp ? (b.data.timestamp.toDate ? b.data.timestamp.toDate().getTime() : new Date(b.data.timestamp).getTime()) : 0;
                return timeB - timeA; // Descending
            });

            docs.forEach(docObj => {
                const docSnap = docObj;
                const data = docSnap.data;
                // Ensure auth.currentUser exists before checking read property
                if (!auth.currentUser) return;
                
                const isRead = data.readBy && data.readBy.includes(auth.currentUser.uid);
                if(!isRead) newCount++;
                
                html += `<li class="${isRead ? '' : 'bg-light'}">
                    <a class="dropdown-item py-2 mark-read-btn" href="#" data-id="${docSnap.id}">
                        <div class="d-flex align-items-center">
                            <i class="bi bi-envelope${isRead ? '-open' : '-fill text-primary'} me-2 fs-5"></i>
                            <div>
                                <span class="d-block ${isRead ? 'text-muted' : 'fw-bold'}">${data.message || 'Notification'}</span>
                                <small class="text-muted" style="font-size: 0.75rem;">${data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString() : 'Just now'}</small>
                            </div>
                        </div>
                    </a>
                </li>`;
            });
        }

        notificationList.innerHTML = html;

        if(newCount > 0) {
            notifBadge.textContent = newCount > 9 ? '9+' : newCount;
            notifBadge.classList.remove('d-none');
        } else {
            notifBadge.classList.add('d-none');
        }

        // Bind click events to mark as read
        document.querySelectorAll('.mark-read-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const notifId = btn.getAttribute('data-id');
                if(!auth.currentUser) return;
                try {
                    await updateDoc(doc(db, "notifications", notifId), {
                        readBy: arrayUnion(auth.currentUser.uid)
                    });
                } catch(error) {
                    console.error("Error marking read:", error);
                }
            });
        });

        // Toast logic for new adds (only fire if NOT initial load)
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" && !isInitialLoad) {
                const d = change.doc.data();
                if(!auth.currentUser) return;
                // Only toast if it hasn't been read by this user
                if (!d.readBy || !d.readBy.includes(auth.currentUser.uid)) {
                     showToast("New Activity", d.message || "You have a new update!");
                }
            }
        });
        
        isInitialLoad = false;
    }, (error) => {
        console.error("Notification listener error:", error);
    });
}
// ==========================================
// ATTENDANCE CHECKER & CSV EXPORT MODULE
// ==========================================

const attGrade = document.getElementById('att-grade');
const attSection = document.getElementById('att-section');
const attDate = document.getElementById('att-date');
const btnLoadAttendance = document.getElementById('btn-load-attendance');
const attendanceList = document.getElementById('attendance-list');
const btnSaveAttendance = document.getElementById('btn-save-attendance');
const btnExportCSV = document.getElementById('btn-export-csv');
const attStatusText = document.getElementById('att-status-text');
const attAlert = document.getElementById('attendance-alert');

let currentAttendanceDocs = []; // Holds current loaded students

// Default to today
if (attDate) {
    attDate.valueAsDate = new Date();
}

if (btnLoadAttendance) {
    btnLoadAttendance.addEventListener('click', async () => {
        const grade = attGrade.value;
        const section = attSection.value.trim();
        const dateVal = attDate.value;
        
        if (!grade || !dateVal) {
            alert("Please select both Grade and Date.");
            return;
        }

        try {
            btnLoadAttendance.disabled = true;
            btnLoadAttendance.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Loading...';
            
            // 1. Fetch Students
            const studentsRef = collection(db, "users");
            let qConstraints = [where("role", "==", "student"), where("gradeLevel", "==", grade)]; // MATCHING db schema 'gradeLevel'
            if (section && section !== "All") {
                qConstraints.push(where("section", "==", section));
            }
            const q = query(studentsRef, ...qConstraints);
            const studentSnaps = await getDocs(q);
            
            if (studentSnaps.empty) {
                attendanceList.innerHTML = '<tr><td colspan="2" class="text-center">No students found matching this criteria.</td></tr>';
                btnSaveAttendance.classList.add('d-none');
                btnExportCSV.classList.add('d-none');
                attStatusText.innerText = "No students found.";
                return;
            }

            // 2. Fetch existing attendance for this date (so teachers can update it)
            const attRef = collection(db, "attendance");
            const attQ = query(attRef, 
                where("date", "==", dateVal),
                where("grade", "==", grade),
                ...(section && section !== "All" ? [where("section", "==", section)] : [])
            );
            const existingAttSnaps = await getDocs(attQ);
            
            // Build a map of existing statuses: { studentId: "Present" }
            const existingStatusMap = {};
            existingAttSnaps.forEach(doc => {
                const data = doc.data();
                if (data.studentId && data.status) {
                    existingStatusMap[data.studentId] = { id: doc.id, status: data.status };
                }
            });

            // 3. Render Table
            attendanceList.innerHTML = '';
            currentAttendanceDocs = []; // reset
            
            studentSnaps.forEach((studentDoc) => {
                const sData = studentDoc.data();
                const existing = existingStatusMap[studentDoc.id] || null;
                const status = existing ? existing.status : 'Present'; // Default to Present
                
                // Keep track of docs for saving
                currentAttendanceDocs.push({
                    uid: studentDoc.id,
                    name: sData.name || sData.displayName || "Unknown",
                    grade: grade,
                    section: section,
                    existingDocId: existing ? existing.id : null
                });

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><div class="fw-bold text-dark">${sData.name || sData.displayName || "Unknown"}</div></td>
                    <td>
                        <select class="form-select form-select-sm att-status-select border-${getStatusColor(status)}" data-uid="${studentDoc.id}">
                            <option value="Present" ${status === 'Present' ? 'selected' : ''}>Present</option>
                            <option value="Late" ${status === 'Late' ? 'selected' : ''}>Late</option>
                            <option value="Absent" ${status === 'Absent' ? 'selected' : ''}>Absent</option>
                        </select>
                    </td>
                `;
                attendanceList.appendChild(tr);
            });

            // Colorize dropdowns dynamically on change
            document.querySelectorAll('.att-status-select').forEach(sel => {
                sel.addEventListener('change', (e) => {
                    e.target.classList.remove('border-success', 'border-warning', 'border-danger', 'border-secondary');
                    e.target.classList.add(`border-${getStatusColor(e.target.value)}`);
                });
            });

            btnSaveAttendance.classList.remove('d-none');
            btnExportCSV.classList.remove('d-none');
            attStatusText.innerText = `Showing ${currentAttendanceDocs.length} students for ${dateVal}`;
            
        } catch (err) {
            console.error(err);
            alert("Error loading students. See console.");
        } finally {
            btnLoadAttendance.disabled = false;
            btnLoadAttendance.innerHTML = 'Load Class';
        }
    });
}

if (btnSaveAttendance) {
    btnSaveAttendance.addEventListener('click', async () => {
        const dateVal = attDate.value;
        if (!dateVal) return;
        
        btnSaveAttendance.disabled = true;
        btnSaveAttendance.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';

        try {
            // Get all dropdowns
            const selects = document.querySelectorAll('.att-status-select');
            const batchPromises = [];
            
            selects.forEach(sel => {
                const uid = sel.getAttribute('data-uid');
                const status = sel.value;
                const studentMeta = currentAttendanceDocs.find(d => d.uid === uid);
                
                if (studentMeta) {
                    const data = {
                        studentId: studentMeta.uid,
                        studentName: studentMeta.name,
                        date: dateVal,
                        grade: studentMeta.grade,
                        section: studentMeta.section,
                        status: status,
                        timestamp: serverTimestamp()
                    };

                    if (studentMeta.existingDocId) {
                        // Update
                        batchPromises.push(updateDoc(doc(db, "attendance", studentMeta.existingDocId), { status: status, timestamp: serverTimestamp() }));
                    } else {
                        // Create new
                        const newRef = doc(collection(db, "attendance"));
                        batchPromises.push(setDoc(newRef, data));
                        studentMeta.existingDocId = newRef.id; // cache ID in case they hit save again
                    }
                }
            });

            await Promise.all(batchPromises);
            
            attAlert.classList.remove('d-none');
            setTimeout(() => { attAlert.classList.add('d-none'); }, 3000);
            
        } catch (err) {
            console.error(err);
            alert("Failed to save attendance.");
        } finally {
            btnSaveAttendance.disabled = false;
            btnSaveAttendance.innerHTML = 'Save Attendance';
        }
    });
}

// Export CSV Feature
if (btnExportCSV) {
    btnExportCSV.addEventListener('click', () => {
        const dateValRaw = attDate.value;
        // Format to MM/DD/YYYY to look better in Excel and fit default column widths
        const dParts = dateValRaw.split('-');
        const dateValFormatted = dParts.length === 3 ? `${dParts[1]}/${dParts[2]}/${dParts[0]}` : dateValRaw;
        
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Date,Grade,Section,Student Name,Status\n";
        
        const selects = document.querySelectorAll('.att-status-select');
        selects.forEach(sel => {
            const uid = sel.getAttribute('data-uid');
            const status = sel.value;
            const studentMeta = currentAttendanceDocs.find(d => d.uid === uid);
            if (studentMeta) {
                // Escape quotes/commas for CSV safety
                const safeName = studentMeta.name.replace(/"/g, '""');
                csvContent += `${dateValFormatted},${studentMeta.grade},${studentMeta.section},"${safeName}",${status}\n`;
            }
        });
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Attendance_Class_${dateValRaw}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

function getStatusColor(status) {
    if (status === 'Present') return 'success';
    if (status === 'Late') return 'warning';
    if (status === 'Absent') return 'danger';
    return 'secondary';
}

