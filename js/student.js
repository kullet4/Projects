import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs, updateDoc, increment, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// DOM Elements
const userGreeting = document.getElementById('user-greeting');
const logoutBtn = document.getElementById('logout-btn');
const xpPoints = document.getElementById('xp-points');
const leaderboardList = document.getElementById('leaderboard-list');
const learningModules = document.getElementById('learning-modules');

let currentXP = 0;
let userDocRef = null;
let completedModulesList = [];
let currentStudentGrade = '';
let currentStudentSection = '';

// Gamification Modal Variables
let currentLessonChunks = [];
let currentChunkIndex = 0;
let userAnswers = {};
let currentLessonImageUrl = '';
let currentLessonPdfUrl = '';
let currentLessonXP = 0;
let currentLessonCard = null;
let currentModId = null;
let isReviewMode = false;

// DOM Modal Elements
const lessonModal = new bootstrap.Modal(document.getElementById('lessonModal'));
const lessonModalTitle = document.getElementById('lessonModalTitle');
const lessonChunkText = document.getElementById('lesson-chunk-text');
const lessonProgress = document.getElementById('lesson-progress');
const lessonNextBtn = document.getElementById('lesson-next-btn');
const lessonBackBtn = document.getElementById('lesson-back-btn');
const lessonFinishBtn = document.getElementById('lesson-finish-btn');
const closeLessonBtn = document.getElementById('close-lesson-btn');

async function syncPublicLeaderboard(xp, gradeLevel, section, displayName) {
    try {
        if (!auth.currentUser) return;
        await setDoc(doc(db, "leaderboard_public", auth.currentUser.uid), {
            displayName: displayName || 'Anonymous Learner',
            xp: Number.isFinite(xp) ? xp : 0,
            gradeLevel: gradeLevel || 'Unknown',
            section: section || 'All',
            updatedAt: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.warn("Failed to sync leaderboard profile:", error);
    }
}

// Enforce authentication & role
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists() && userDoc.data().role === 'student') {
                const userData = userDoc.data();
                const studentName = userData.name || 'Student';
                
                // Update UI greetings
                userGreeting.textContent = studentName;
                const mainGreetingName = document.getElementById('main-greeting-name');
                if(mainGreetingName) mainGreetingName.textContent = studentName.split(' ')[0]; // Just use first name for bubbly feel
                
                const studentGrade = userData.gradeLevel || 'Grade 1'; // Default
                const studentSection = userData.section || 'All';
                currentStudentGrade = studentGrade;
                currentStudentSection = studentSection;

                // Setup Badges
                const gradeBadge = document.getElementById('student-grade-badge');
                if(gradeBadge) gradeBadge.textContent = studentGrade;
                const sectionBadge = document.getElementById('student-section-badge');
                if(sectionBadge) {
                    sectionBadge.textContent = studentSection.toLowerCase() === 'all' 
                        ? "All Sections" 
                        : (studentSection.toLowerCase().includes('section') ? studentSection : "Section " + studentSection);
                }

                // --- Gamification: Competence (Points & Progress)
                currentXP = userData.xp || 0;
                completedModulesList = userData.completedModules || [];
                xpPoints.textContent = '0';

                // Keep a privacy-safe leaderboard projection in sync.
                await syncPublicLeaderboard(currentXP, studentGrade, studentSection, studentName);
                
                // Animate XP
                animateValue(xpPoints, 0, currentXP, 1000);

                // --- Gamification: Phase 2 Grade Progress Generation (ZERO Reads Calculation) ---
                const scores = userData.scores || { wwRaw: 0, wwMax: 100, ptRaw: 0, ptMax: 100, qaRaw: 0, qaMax: 100 };
                const trackStr = userData.track || 'LANGUAGE_AP_ESP';
                const weightTrack = window.DEPED_WEIGHTS[trackStr] || window.DEPED_WEIGHTS.LANGUAGE_AP_ESP;
                
                const gradeResult = window.DepEdGrader.calculateGrade(scores, weightTrack);
                
                // Update Student Phase 2 UI
                document.getElementById('student-transmuted-grade').textContent = gradeResult.transmutedGrade + "%";
                document.getElementById('student-descriptor').textContent = "(" + gradeResult.descriptor + ")";
                document.getElementById('student-initial-grade').textContent = "Initial: " + gradeResult.initialGrade;
                
                const progressEl = document.getElementById('student-grade-progress');
                progressEl.style.width = gradeResult.transmutedGrade + "%";
                progressEl.setAttribute('aria-valuenow', gradeResult.transmutedGrade);
                
                // Color code the progress bar based on performance
                if (gradeResult.transmutedGrade >= 90) progressEl.className = 'progress-bar bg-success';
                else if (gradeResult.transmutedGrade >= 80) progressEl.className = 'progress-bar bg-primary';
                else if (gradeResult.transmutedGrade >= 75) progressEl.className = 'progress-bar bg-warning';
                else progressEl.className = 'progress-bar bg-danger';

                // Load Leaderboard and Modules
                loadLeaderboard(studentGrade, studentSection);
                loadModules(studentGrade, studentSection);

            } else {
                // Not a student, boot them out
                window.location.href = 'index.html';
            }
        } catch (error) {
            console.error("Error fetching student data:", error);
            alert("Error loading dashboard data. You might be offline, using cached mode.");
        }
    } else {
        window.location.href = 'index.html'; // Redirect to login
    }
});

// Load the Learning Modules from Firestore
async function loadModules(studentGrade, studentSection) {
    try {
        const modulesRef = collection(db, "modules");
        const q = query(modulesRef, orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        
        learningModules.innerHTML = '';
        
        let modulesAdded = 0;

        if(querySnapshot.empty) {
            learningModules.innerHTML = `<div class="col-12"><p class="text-muted">No learning modules available right now. Check back later!</p></div>`;
            return;
        }
        
        querySnapshot.forEach((docSnap) => {
            const modData = docSnap.data();
            
            // Filter by Grade and Section (Client-side for prototype to avoid complex index requirements)
            const targetGrade = modData.targetGrade || 'All Grades';
            const targetSection = modData.targetSection ? modData.targetSection.toLowerCase() : 'all';
            
            const isMatchGrade = targetGrade === 'All Grades' || targetGrade === studentGrade;
            const isMatchSection = targetSection === 'all' || targetSection === (studentSection ? studentSection.toLowerCase() : '');
            
            if (!isMatchGrade || !isMatchSection) return; // Skip if not meant for this student

            modulesAdded++;
            const modId = docSnap.id;
            
            // Calculate progress percentage if they have started
            const savedProgress = parseInt(localStorage.getItem('elms_progress_' + modId)) || 0;
            let progressPercent = 0;
            if (savedProgress > 0) {
                const rawContent = modData.content || "Oops! The teacher forgot to write the lesson.";
                const tempChunks = rawContent.split(/(?<=[.!?])\s+|[\n]+/).filter(text => text.trim().length > 0);
                const totalChunks = tempChunks.length === 0 ? 1 : tempChunks.length;
                // Cap it at 99% so they don't see 100% until they actually finish it
                progressPercent = Math.min(99, Math.floor((savedProgress / totalChunks) * 100));
            }

            // Randomize a pastel color block for the module banner to make it playful
            const colors = ['#ffdac1', '#a1c4fd', '#fbc2eb', '#fdcbf1', '#e0c3fc'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];

            const col = document.createElement('div');
            col.className = 'col-md-6';
            col.innerHTML = `
                <div class="card shadow-sm border-0 h-100 module-card overflow-hidden">
                    <div style="height: 10px; background: ${randomColor};"></div>
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="mb-0 fw-bold">${modData.title || 'Untitled Module'}</h6>
                            <span class="badge bg-warning text-dark"><i class="bi bi-star-fill"></i> ${modData.xpReward || 0} XP</span>
                        </div>
                        <p class="text-muted small flex-grow-1">${modData.description || 'No description provided.'}</p>
                        ${savedProgress > 0 && !completedModulesList.includes(modId) ? `
                        <div class="progress mb-2 rounded-pill" style="height: 8px;">
                            <div class="progress-bar bg-info progress-bar-striped progress-bar-animated" role="progressbar" style="width: ${progressPercent}%;"></div>
                        </div>
                        ` : ''}
                        ${completedModulesList.includes(modId) ? `
                        <button class="btn btn-sm btn-success text-white w-100 mt-3 complete-mod-btn fw-bold" 
                            data-xp="${modData.xpReward || 0}" 
                            data-id="${modId}" 
                            data-title="${modData.title}" 
                            data-gradingcategory="${modData.gradingCategory}"
                            data-maxscore="${modData.maxScore}"
                            data-imageurl="${encodeURIComponent(modData.imageUrl || '')}"
                            data-pdfurl="${encodeURIComponent(modData.pdfUrl || '')}"
                            data-modtype="${modData.type || 'reading'}"
                            data-questions="${encodeURIComponent(JSON.stringify(modData.questions || []))}"
                            data-content="${encodeURIComponent(modData.content || "Oops! The teacher forgot to write the lesson.")}">
                            <i class="bi bi-check2-circle fs-5"></i> Review Lesson
                        </button>
                        ` : (savedProgress > 0 ? `
                        <button class="btn btn-sm btn-info text-white w-100 mt-2 complete-mod-btn fw-bold" 
                            data-xp="${modData.xpReward || 0}" 
                            data-id="${modId}" 
                            data-title="${modData.title}" 
                            data-gradingcategory="${modData.gradingCategory}"
                            data-maxscore="${modData.maxScore}"
                            data-imageurl="${encodeURIComponent(modData.imageUrl || '')}"
                            data-pdfurl="${encodeURIComponent(modData.pdfUrl || '')}"
                            data-modtype="${modData.type || 'reading'}"
                            data-questions="${encodeURIComponent(JSON.stringify(modData.questions || []))}"
                            data-content="${encodeURIComponent(modData.content || "Oops! The teacher forgot to write the lesson.")}">
                            <i class="bi bi-play-circle-fill fs-5"></i> Continue (${progressPercent}%)
                        </button>
                        ` : `
                        <button class="btn btn-sm btn-outline-primary w-100 mt-3 complete-mod-btn fw-bold" 
                            data-xp="${modData.xpReward || 0}" 
                            data-id="${modId}" 
                            data-title="${modData.title}" 
                            data-gradingcategory="${modData.gradingCategory}"
                            data-maxscore="${modData.maxScore}"
                            data-imageurl="${encodeURIComponent(modData.imageUrl || '')}"
                            data-pdfurl="${encodeURIComponent(modData.pdfUrl || '')}"
                            data-modtype="${modData.type || 'reading'}"
                            data-questions="${encodeURIComponent(JSON.stringify(modData.questions || []))}"
                            data-content="${encodeURIComponent(modData.content || "Oops! The teacher forgot to write the lesson.")}">
                            <i class="bi bi-play-circle-fill fs-5"></i> Start Learning
                        </button>
                        `)}
                    </div>
                </div>
            `;
            learningModules.appendChild(col);
        });

        if (modulesAdded === 0) {
            learningModules.innerHTML = `<div class="col-12"><p class="text-muted">No learning modules assigned to your Grade/Section yet. Choose an 'All Grades' module or ask your teacher.</p></div>`;
        }

        // Add click events to start lesson buttons
        document.querySelectorAll('.complete-mod-btn').forEach(btn => {
            btn.addEventListener('click', startInteractiveLesson);
        });

    } catch (error) {
        console.error("Error fetching modules:", error);
        learningModules.innerHTML = `<div class="col-12"><p class="text-danger">Failed to load modules securely.</p></div>`;
    }
}

// Start Gamified Interactive Lesson (Duolingo-style micro-learning)
function startInteractiveLesson(e) {
    const btn = e.currentTarget;
    if(btn.disabled) return; 
    
    currentModId = btn.getAttribute('data-id');
    const title = btn.getAttribute('data-title');
    const encodedContent = btn.getAttribute('data-content');
    const rawContent = decodeURIComponent(encodedContent);
    const encodedImageUrl = btn.getAttribute('data-imageurl') || '';
    const encodedPdfUrl = btn.getAttribute('data-pdfurl') || '';
    const modType = btn.getAttribute('data-modtype');
    currentLessonXP = parseInt(btn.getAttribute('data-xp'), 10);
    currentLessonCard = btn; // Save reference to update button state later
    currentLessonImageUrl = encodedImageUrl ? decodeURIComponent(encodedImageUrl) : '';
    currentLessonPdfUrl = encodedPdfUrl ? decodeURIComponent(encodedPdfUrl) : '';
    
    isReviewMode = completedModulesList.includes(currentModId);

    // Parse the lesson chunks based on whether it is a reading module or a quiz
    if (modType === 'quiz') {
        const encodedQuestions = btn.getAttribute('data-questions');
        currentLessonChunks = JSON.parse(decodeURIComponent(encodedQuestions));
        if (currentLessonChunks.length === 0) {
            currentLessonChunks = [{ question: "Oops! The teacher forgot to add questions.", options: [] }];
        }
    } else {
        // Split content into chunks by periods (.) or newlines (\n) if it's reading material
        if(rawContent && rawContent !== "Oops! The teacher forgot to write the lesson." && rawContent !== "undefined") {
            currentLessonChunks = rawContent.split(/(?<=[.!?])\s+|[\n]+/).filter(text => text.trim().length > 0);
        } else {
            currentLessonChunks = ["Let's learn something new!"];
        }
        
        // Failsafe for very short reading lessons
        if(currentLessonChunks.length === 0) currentLessonChunks = ["Let's learn something new!"];
    }

    // Load saved progress if not reviewing
    if (isReviewMode) {
        currentChunkIndex = 0;
        userAnswers = {};
    } else {
        currentChunkIndex = 0; // Defaulting to 0 for quizzes until we implement saved answers
        userAnswers = {};
    }
    
    // Prep Modal UI
    lessonModalTitle.textContent = title;
    lessonNextBtn.parentElement.classList.remove('d-none');
    lessonFinishBtn.classList.add('d-none');
    updateLessonChunk();
    
    // Open Modal
    lessonModal.show();
}

// Update the chunk text and progress bar
function updateLessonChunk() {
    const modType = currentLessonCard ? currentLessonCard.getAttribute('data-modtype') : 'reading';
    
    if (modType === 'quiz') {
        const qData = currentLessonChunks[currentChunkIndex];
        let optionsHTML = '';
        if (qData.options && Array.isArray(qData.options)) {
            qData.options.forEach((opt, idx) => {
                const isSelected = userAnswers[currentChunkIndex] === idx ? 'checked' : '';
                optionsHTML += `
                    <div class="form-check text-start mb-3 fs-5 ms-3">
                        <input class="form-check-input border-primary" type="radio" name="q-${currentChunkIndex}" id="q-${currentChunkIndex}-opt-${idx}" value="${idx}" ${isSelected}>
                        <label class="form-check-label ms-2" for="q-${currentChunkIndex}-opt-${idx}">${opt}</label>
                    </div>
                `;
            });
        }

        lessonChunkText.innerHTML = `
            <div class="w-100 text-start">
                <span class="badge bg-primary mb-3">Question ${currentChunkIndex + 1} of ${currentLessonChunks.length}</span>
                <h4 class="mb-4 fw-bold text-dark lh-base" style="font-size: 1.4rem;">${qData.question || 'Missing question text'}</h4>
                <div class="d-flex flex-column gap-2">
                    ${optionsHTML}
                </div>
            </div>
        `;
    } else {
        lessonChunkText.innerHTML = `
            <div class="w-100 text-start">
                ${currentLessonImageUrl ? `<img src="${currentLessonImageUrl}" alt="Lesson image" class="img-fluid rounded border shadow-sm mb-3">` : ''}
                ${currentLessonPdfUrl ? `<div class="mb-3"><a href="${currentLessonPdfUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary fw-bold"><i class="bi bi-file-earmark-pdf"></i> Open PDF</a></div>` : ''}
                <p class="mb-0">${currentLessonChunks[currentChunkIndex]}</p>
            </div>
        `;
    }
    
    // Toggle Back button
    if(currentChunkIndex > 0) {
        lessonBackBtn.classList.remove('d-none');
    } else {
        lessonBackBtn.classList.add('d-none');
    }

    // Calculate progress (Competence)
    const progressPercent = Math.floor((currentChunkIndex / currentLessonChunks.length) * 100);
    lessonProgress.style.width = `${progressPercent}%`;

    // Swap buttons if on last chunk
    if(currentChunkIndex === currentLessonChunks.length - 1) {
        lessonNextBtn.parentElement.classList.add('d-none');
        lessonFinishBtn.classList.remove('d-none');
        lessonProgress.style.width = `100%`;
        lessonProgress.classList.replace('bg-warning', 'bg-success');
        
        if (isReviewMode) {
            lessonFinishBtn.innerHTML = `Great Job Reviewing! 👍`;
        } else {
            lessonFinishBtn.innerHTML = `🌟 Complete & Earn ${currentLessonXP} XP!`;
        }
    } else {
        lessonNextBtn.parentElement.classList.remove('d-none');
        lessonFinishBtn.classList.add('d-none');
        lessonProgress.classList.replace('bg-success', 'bg-warning');
        
        if (!isReviewMode) {
            localStorage.setItem('elms_progress_' + currentModId, currentChunkIndex);
        }
    }
}

// Next Button Handler
lessonNextBtn.addEventListener('click', () => {    
    const modType = currentLessonCard ? currentLessonCard.getAttribute('data-modtype') : 'reading';

    if (modType === 'quiz') {
        const checkedOption = document.querySelector(`input[name="q-${currentChunkIndex}"]:checked`);
        if (!checkedOption) {
            alert("Please select an answer to continue.");
            return;
        } else {
            userAnswers[currentChunkIndex] = parseInt(checkedOption.value, 10);
        }
    }
    if(currentChunkIndex < currentLessonChunks.length - 1) {
        currentChunkIndex++;
        animateChunkChange();
    }
});

// Back Button Handler
lessonBackBtn.addEventListener('click', () => {
    if(currentChunkIndex > 0) {
        currentChunkIndex--;
        animateChunkChange();
    }
});

function animateChunkChange() {
    // Add a fun bounce animation to text for engagement
    lessonChunkText.style.transform = 'scale(0.95)';
    setTimeout(() => {
        updateLessonChunk();
        lessonChunkText.style.transform = 'scale(1)';
        lessonChunkText.style.transition = 'transform 0.2s ease';
    }, 150);
}

// Final Finish Button Handler / Gain XP (Mastery Achieved)
lessonFinishBtn.addEventListener('click', async () => {
    if (isReviewMode) {
        lessonModal.hide();
        return;
    }

    const modType = currentLessonCard ? currentLessonCard.getAttribute('data-modtype') : 'reading';

    // Validate that questions are answered before submitting a quiz
    if (modType === 'quiz') {
        const checkedOption = document.querySelector(`input[name="q-${currentChunkIndex}"]:checked`);
        if (!checkedOption) {
            alert("Please select an answer before finishing the quiz!");
            return;
        }
    }

    lessonFinishBtn.disabled = true;
    lessonFinishBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Verifying...`;
    
    try {
        if (modType === 'quiz') {
            // === CALCULATE SCORE WITH SCALING ===
            let rawCorrect = 0;
            currentLessonChunks.forEach((q, idx) => {
                const checkedOption = document.querySelector(`input[name="q-${idx}"]:checked`);
                if (checkedOption) {
                    const userChoice = parseInt(checkedOption.value, 10);
                    if(userChoice === q.correctIndex) {
                        rawCorrect++;
                    }
                }
            });

            // Scale it to the expected Max Score set by the teacher
            const maxItems = currentLessonChunks.length;
            let expectedMaxScore = maxItems;
            if (currentLessonCard.dataset.maxscore && currentLessonCard.dataset.maxscore !== "undefined") {
                 expectedMaxScore = parseFloat(currentLessonCard.dataset.maxscore);
            }
            
            // Example: (5 / 10) * 100 = 50
            const scaledScore = expectedMaxScore > 0 ? (rawCorrect / maxItems) * expectedMaxScore : rawCorrect;

            // Ensure student has default scores 
            const userData = (await getDoc(userDocRef)).data();
            let scores = userData.scores || { wwRaw: 0, wwMax: 0, ptRaw: 0, ptMax: 0, qaRaw: 0, qaMax: 0 };
            const gradingCategory = currentLessonCard.dataset.gradingcategory || 'none';
            
            // Add to DepEd Category if not 'none'
            if (gradingCategory === 'ww') {
                scores.wwRaw += scaledScore;
                scores.wwMax += expectedMaxScore;
            } else if (gradingCategory === 'pt') {
                scores.ptRaw += scaledScore;
                scores.ptMax += expectedMaxScore;
            } else if (gradingCategory === 'qa') {
                scores.qaRaw += scaledScore;
                scores.qaMax += expectedMaxScore;
            }

            // Safe database update
            await updateDoc(userDocRef, {
                xp: increment(currentLessonXP),
                completedModules: arrayUnion(currentModId),
                scores: scores
            });

            // Display Result immediately
            const lessonContentEl = document.getElementById('lesson-chunk-text').parentElement;
            lessonContentEl.innerHTML = `
                <div class="text-center w-100">
                    <h1 class="display-1 mb-3">🎉</h1>
                    <h2 class="text-success fw-bold">Quiz Complete!</h2>
                    <h3 class="display-3 fw-bold text-primary mb-3">${scaledScore.toFixed(0)} / ${expectedMaxScore}</h3>
                    <p class="fs-5 text-muted mb-4">You got ${rawCorrect} out of ${maxItems} items correct.</p>
                    <div class="spinner-border text-primary" role="status"></div><br>
                    <small class="text-muted mt-2 d-inline-block">Syncing score to DepEd Grader...</small>
                </div>
            `;
        } else {
            // Safe database update for reading material (just XP)
            await updateDoc(userDocRef, {
                xp: increment(currentLessonXP),
                completedModules: arrayUnion(currentModId)
            });
        }
        
        // Remove locally saved progress
        localStorage.removeItem('elms_progress_' + currentModId);
        
        // Update Local Arrays & UI
        completedModulesList.push(currentModId);
        let oldXP = currentXP;
        currentXP += currentLessonXP;
        animateValue(xpPoints, oldXP, currentXP, 1200);
        await syncPublicLeaderboard(currentXP, currentStudentGrade, currentStudentSection, userGreeting.textContent || 'Anonymous Learner');
        loadLeaderboard(currentStudentGrade, currentStudentSection);

        // Update the card button for Review Mode
        currentLessonCard.disabled = false;
        currentLessonCard.classList.remove('btn-outline-primary');
        currentLessonCard.classList.add('btn-success', 'text-white');
        currentLessonCard.innerHTML = `<i class="bi bi-check2-circle fs-5"></i> Review Lesson`;

        // Close Modal
        lessonModal.hide();
        
    } catch (error) {
        console.error("Failed to sync XP:", error);
        lessonFinishBtn.innerHTML = `Error. Try again.`;
    } finally {
        lessonFinishBtn.disabled = false;
        lessonFinishBtn.innerHTML = `🌟 Complete & Earn XP!`;
    }
});

// Logout Handler
logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.href = 'index.html';
    });
});

// --- Gamification: Relatedness (Leaderboard) ---
// Queries Firestore for top 5 students based on XP
async function loadLeaderboard() {
    try {
        const leaderboardRef = collection(db, "leaderboard_public");
        // Query only same classroom (grade + section) for privacy-safe leaderboard.
        // NOTE: Firebase might require a composite index for this query the first time it runs.
        // If it fails, check the console for a Firebase link to build the index.
        const q = query(
            leaderboardRef,
            where("gradeLevel", "==", currentStudentGrade),
            where("section", "==", currentStudentSection),
            orderBy("xp", "desc"),
            limit(5)
        );
        
        const querySnapshot = await getDocs(q);
        
        leaderboardList.innerHTML = ''; // Clear loading state
        
        let rank = 1;
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const isCurrentUser = auth.currentUser && docSnap.id === auth.currentUser.uid;
            
            const li = document.createElement('li');
            li.className = `list-group-item d-flex justify-content-between align-items-center ${isCurrentUser ? 'bg-light fw-bold' : ''}`;
            
            // Medal coloring logic
            let rankBadge = rank;
            if(rank === 1) rankBadge = `<i class="bi bi-award-fill text-warning fs-5"></i>`;
            else if(rank === 2) rankBadge = `<i class="bi bi-award-fill text-secondary fs-5"></i>`;
            else if(rank === 3) rankBadge = `<i class="bi bi-award-fill text-danger fs-5" style="color: #cd7f32 !important;"></i>`;

            li.innerHTML = `
                <div class="d-flex align-items-center">
                    <span class="me-3 text-muted" style="width: 24px; text-align: center;">${rankBadge}</span>
                    <span>${data.displayName || 'Anonymous Learner'}</span>
                </div>
                <span class="badge bg-primary rounded-pill">${data.xp || 0} XP</span>
            `;
            leaderboardList.appendChild(li);
            rank++;
        });

        if(leaderboardList.innerHTML === '') {
             leaderboardList.innerHTML = `<li class="list-group-item text-center text-muted">No ranking data yet.</li>`;
        }

    } catch (error) {
        console.error("Error loading leaderboard:", error);
        leaderboardList.innerHTML = `
            <li class="list-group-item text-center text-danger border-0">
                <i class="bi bi-exclamation-triangle"></i> Cannot load section leaderboard right now.
            </li>`;
    }
}

// Simple counter animation function
function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}
