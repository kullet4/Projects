import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { onSnapshot, arrayUnion, where, limit, doc, getDoc, collection, query, orderBy, getDocs, updateDoc, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// DOM Elements
const userGreeting = document.getElementById('user-greeting');
const logoutBtn = document.getElementById('logout-btn');
const xpPoints = document.getElementById('xp-points');
const learningModules = document.getElementById('learning-modules');

let currentXP = 0;
let userDocRef = null;
let completedModulesList = [];

// Avatar System
const AVATAR_ROSTER = [
    { id: 'base_user', icon: '👤', name: 'Base User', cost: 0 },
    { id: 'baby_chick', icon: '🐣', name: 'Baby Chick', cost: 100 },
    { id: 'turtle', icon: '🐢', name: 'Turtle', cost: 250 },
    { id: 'fox', icon: '🦊', name: 'Clever Fox', cost: 500 },
    { id: 'bear', icon: '🐻', name: 'Brave Bear', cost: 750 },
    { id: 'panda', icon: '🐼', name: 'Panda', cost: 1000 },
    { id: 'lion', icon: '🦁', name: 'Fierce Lion', cost: 1500 },
    { id: 'alien', icon: '👽', name: 'Mystic Alien', cost: 3000 },
    { id: 'robot', icon: '🤖', name: 'Mecha Robot', cost: 5000 }
];
let equippedAvatar = 'base_user';
let unlockedAvatars = ['base_user'];
let shopSelectedAvatarId = null;

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

function getCompletedModuleId(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.moduleId === 'string') return entry.moduleId;
    return null;
}

function buildCompletedModuleIdSet(entries) {
    const ids = new Set();
    if (!Array.isArray(entries)) return ids;
    entries.forEach((entry) => {
        const modId = getCompletedModuleId(entry);
        if (modId) ids.add(modId);
    });
    return ids;
}

function isUniversalTarget(value, kind) {
    const normalized = (value || '').toString().trim().toLowerCase();
    if (kind === 'grade') {
        return normalized === 'all grades' || normalized === 'all' || normalized === 'any' || normalized === 'everyone';
    }
    return normalized === 'all' || normalized === 'all sections' || normalized === 'any' || normalized === 'everyone';
}

let completedModuleIds = new Set();

// DOM Modal Elements
const lessonModal = new bootstrap.Modal(document.getElementById('lessonModal'));
const lessonModalTitle = document.getElementById('lessonModalTitle');
const lessonChunkText = document.getElementById('lesson-chunk-text');
const lessonProgress = document.getElementById('lesson-progress');
const lessonNextBtn = document.getElementById('lesson-next-btn');
const lessonBackBtn = document.getElementById('lesson-back-btn');
const lessonFinishBtn = document.getElementById('lesson-finish-btn');
const closeLessonBtn = document.getElementById('close-lesson-btn');

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

                // Setup Avatar
                equippedAvatar = userData.equippedAvatar || 'base_user';
                unlockedAvatars = userData.unlockedAvatars || ['base_user'];
                updateNavAvatar();

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
                completedModuleIds = buildCompletedModuleIdSet(completedModulesList);
                xpPoints.textContent = '0';

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

                // Load Modules
                loadModules(studentGrade, studentSection);
                listenForNotifications("student", studentGrade);

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
        
        // 1. Create a Bucket for each grading category
        const moduleBuckets = {
            'ww': { title: 'Written Works', items: [] },
            'pt': { title: 'Performance Tasks', items: [] },
            'qa': { title: 'Quarterly Assessments', items: [] },
            'other': { title: 'Other Activities', items: [] } 
        };
        
        querySnapshot.forEach((docSnap) => {
            const modData = docSnap.data();
            
            // Filter by Grade and Section (Client-side for prototype to avoid complex index requirements)
            const targetGrade = modData.targetGrade || 'All Grades';
            const targetSection = modData.targetSection ? modData.targetSection.toLowerCase() : 'all';
            
            const isMatchGrade = isUniversalTarget(targetGrade, 'grade') || targetGrade === studentGrade;
            const isMatchSection = isUniversalTarget(targetSection, 'section') || targetSection === (studentSection ? studentSection.toLowerCase() : '');
            
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

            const category = modData.gradingCategory || 'other';
            const bucketKey = moduleBuckets[category] ? category : 'other';
            moduleBuckets[bucketKey].items.push({ id: modId, data: modData, savedProgress, progressPercent });
        });

        if (modulesAdded === 0) {
            learningModules.innerHTML = `<div class="col-12"><p class="text-muted">No learning modules assigned to your Grade/Section yet. Choose an 'All Grades' module or ask your teacher.</p></div>`;
            return;
        }

        // 3. Build the Accordion HTML
        let accordionHTML = '<div class="accordion w-100" id="modulesAccordion">';
        let index = 0;

        for (const [catKey, bucket] of Object.entries(moduleBuckets)) {
            if (bucket.items.length === 0) continue; // Skip empty categories
            
            const showClass = index === 0 ? 'show' : ''; // Open the first one by default
            const collapsedClass = index === 0 ? '' : 'collapsed';
            
            let listItemsHTML = '<ul class="list-group list-group-flush rounded-bottom">';
            bucket.items.forEach(item => {
                const isCompleted = completedModuleIds.has(item.id);
                const modData = item.data;
                const iconClass = modData.type === 'quiz' ? 'bi-patch-question-fill text-danger' : 'bi-file-earmark-text-fill text-primary';
                
                // Button HTML based on state
                let actionBtnHTML = '';
                const btnDataAttrs = `data-xp="${modData.xpReward || 0}" data-id="${item.id}" data-title="${modData.title}" data-gradingcategory="${modData.gradingCategory}" data-maxscore="${modData.maxScore}" data-imageurl="${encodeURIComponent(modData.imageUrl || '')}" data-pdfurl="${encodeURIComponent(modData.pdfUrl || '')}" data-modtype="${modData.type || 'reading'}" data-questions="${encodeURIComponent(JSON.stringify(modData.questions || []))}" data-content="${encodeURIComponent(modData.content || "Oops! The teacher forgot to write the lesson.")}"`;

                if (isCompleted) {
                    if (modData.type === 'quiz') {
                        // Find the completed record to display the score
                        let scoreLabel = '';
                        const record = completedModulesList.find(r => getCompletedModuleId(r) === item.id);
                        if (record && record.maxScore && record.maxScore > 0) {
                            scoreLabel = `<span class="badge bg-warning text-dark me-2">Score: ${record.score}/${record.maxScore}</span>`;
                        }
                        
                        // Disable the button entirely for completed Quizzes to prevent re-viewing questions
                        actionBtnHTML = `
                            <div class="d-flex align-items-center">
                                ${scoreLabel}
                                <button class="btn btn-sm btn-success text-white fw-bold d-flex align-items-center" disabled>
                                    <i class="bi bi-shield-check me-1"></i> Completed
                                </button>
                            </div>
                        `;
                    } else {
                        // Allow reviewing for Lessons/Reading Material
                        actionBtnHTML = `
                            <button class="btn btn-sm btn-success text-white complete-mod-btn fw-bold d-flex align-items-center" ${btnDataAttrs}>
                                <i class="bi bi-book-half me-1"></i> Review
                            </button>
                        `;
                    }
                } else if (item.savedProgress > 0) {
                    actionBtnHTML = `
                        <button class="btn btn-sm btn-info text-white complete-mod-btn fw-bold d-flex align-items-center" ${btnDataAttrs}>
                            <i class="bi bi-play-circle-fill me-1"></i> ( ${item.progressPercent}% )
                        </button>
                    `;
                } else {
                    actionBtnHTML = `
                        <button class="btn btn-sm btn-outline-primary complete-mod-btn fw-bold d-flex align-items-center" ${btnDataAttrs}>
                            <i class="bi bi-play-circle-fill me-1"></i> Start
                        </button>
                    `;
                }

                // If a PDF URL is present, create a link directly beneath the title
                let pdfLinkHTML = '';
                if (modData.pdfUrl && modData.pdfUrl.trim() !== '') {
                    pdfLinkHTML = `<br><a href="${modData.pdfUrl}" target="_blank" class="text-secondary small text-decoration-none mt-1 d-inline-block"><i class="bi bi-link-45deg"></i> View Attachment PDF</a>`;
                }

                listItemsHTML += `
                    <li class="list-group-item d-flex justify-content-between align-items-center py-3 bg-white">
                        <div class="pe-3">
                            <h6 class="mb-0 text-dark fw-bold"><i class="${iconClass} me-2 fs-5 align-middle"></i> ${modData.title || 'Untitled Module'}</h6>
                            ${pdfLinkHTML}
                        </div>
                        <div class="d-flex align-items-center gap-3">
                            <span class="badge bg-warning text-dark"><i class="bi bi-star-fill align-middle"></i> ${modData.xpReward || 0} XP</span>
                            ${actionBtnHTML}
                        </div>
                    </li>
                `;
            });
            listItemsHTML += '</ul>';

            accordionHTML += `
                <div class="accordion-item shadow-sm border-0 mb-3 rounded" style="overflow: hidden;">
                    <h2 class="accordion-header" id="heading${catKey}">
                        <button class="accordion-button ${collapsedClass} fw-bold text-dark bg-light" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${catKey}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="collapse${catKey}">
                            ${bucket.title} <span class="badge bg-secondary ms-2">${bucket.items.length}</span>
                        </button>
                    </h2>
                    <div id="collapse${catKey}" class="accordion-collapse collapse ${showClass}" aria-labelledby="heading${catKey}" data-bs-parent="#modulesAccordion">
                        <div class="accordion-body p-0 border-top bg-white">
                            ${listItemsHTML}
                        </div>
                    </div>
                </div>
            `;
            index++;
        }
        accordionHTML += '</div>';

        learningModules.innerHTML = accordionHTML;

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
    
    isReviewMode = completedModuleIds.has(currentModId);

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
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) {
            throw new Error("User profile not found.");
        }

        const userData = userSnap.data();
        const latestCompletedModules = Array.isArray(userData.completedModules) ? userData.completedModules : [];
        const latestCompletedIds = buildCompletedModuleIdSet(latestCompletedModules);

        // Avoid duplicate rewards if this module was already completed from another tab/session.
        if (latestCompletedIds.has(currentModId)) {
            completedModulesList = latestCompletedModules;
            completedModuleIds = latestCompletedIds;
            lessonModal.hide();
            return;
        }

        const currentModuleTitle = currentLessonCard?.dataset?.title || 'Untitled Module';
        const gradingCategory = currentLessonCard?.dataset?.gradingcategory || 'none';
        const completionRecord = {
            moduleId: currentModId,
            title: currentModuleTitle,
            gradingCategory: gradingCategory,
            score: 0,
            maxScore: 0,
            xpAwarded: currentLessonXP,
            completedAt: new Date().toISOString()
        };

        let scores = userData.scores || { wwRaw: 0, wwMax: 0, ptRaw: 0, ptMax: 0, qaRaw: 0, qaMax: 0 };

        if (modType === 'quiz') {
            // === CALCULATE SCORE WITH SCALING ===
            // Scale by teacher-defined max score. Correct-answer validation is handled by teacher review.
            const maxItems = currentLessonChunks.length;
            let expectedMaxScore = maxItems;
            if (currentLessonCard.dataset.maxscore && currentLessonCard.dataset.maxscore !== "undefined") {
                 expectedMaxScore = parseFloat(currentLessonCard.dataset.maxscore);
            }

            completionRecord.score = 0;
            completionRecord.maxScore = expectedMaxScore;
            
            // Add only maximum points now. Teachers can override actual score later.
            if (gradingCategory === 'ww') {
                scores.wwMax += expectedMaxScore;
            } else if (gradingCategory === 'pt') {
                scores.ptMax += expectedMaxScore;
            } else if (gradingCategory === 'qa') {
                scores.qaMax += expectedMaxScore;
            }

            // Safe database update
            await updateDoc(userDocRef, {
                xp: (userData.xp || 0) + currentLessonXP,
                completedModules: [...latestCompletedModules, completionRecord],
                scores: scores
            });

            // Notify Teacher about submission
            await addDoc(collection(db, "notifications"), {
                type: "submission",
                message: `${userData.name || 'A student'} submitted quiz: ${currentModuleTitle}`,
                timestamp: serverTimestamp(),
                readBy: []
            });

            // Display Result immediately
            const lessonContentEl = document.getElementById('lesson-chunk-text').parentElement;
            lessonContentEl.innerHTML = `
                <div class="text-center w-100 py-3">
                    <h1 class="display-1 mb-3">🎉</h1>
                    <h2 class="text-success fw-bold">Quiz Submitted!</h2>
                    <h3 class="fs-4 fw-bold text-primary mb-3">Waiting for teacher review</h3>
                    <p class="fs-5 text-muted mb-4">Your answers were saved. Your teacher can now finalize your score.</p>
                    <button type="button" class="btn btn-success btn-lg rounded-pill px-5 mt-3 shadow" data-bs-dismiss="modal">Return to Dashboard</button>
                </div>
            `;
            
            // Hide the default bottom buttons so they don't see the spinner
            document.getElementById('lesson-nav-buttons').classList.add('d-none');
            lessonFinishBtn.classList.add('d-none');
        } else {
            // Safe database update for reading material (just XP)
            await updateDoc(userDocRef, {
                xp: (userData.xp || 0) + currentLessonXP,
                completedModules: [...latestCompletedModules, completionRecord],
                scores: scores
            });
        }
        
        // Remove locally saved progress
        localStorage.removeItem('elms_progress_' + currentModId);
        
        // Update Local Arrays & UI
        completedModulesList = [...latestCompletedModules, completionRecord];
        completedModuleIds = buildCompletedModuleIdSet(completedModulesList);
        let oldXP = currentXP;
        currentXP = (userData.xp || 0) + currentLessonXP;
        animateValue(xpPoints, oldXP, currentXP, 1200);

        // Update the card button for Review Mode
        if (modType === 'quiz') {
            const parent = currentLessonCard.parentElement;
            parent.innerHTML = `
                <div class="d-flex align-items-center">
                    <span class="badge bg-warning text-dark me-2">Score: 0/${completionRecord.maxScore}</span>
                    <button class="btn btn-sm btn-success text-white fw-bold d-flex align-items-center" disabled>
                        <i class="bi bi-shield-check me-1"></i> Completed
                    </button>
                </div>
            `;
        } else {
            currentLessonCard.disabled = false;
            currentLessonCard.classList.remove('btn-outline-primary', 'btn-info');
            currentLessonCard.classList.add('btn-success', 'text-white');
            currentLessonCard.innerHTML = `<i class="bi bi-book-half me-1"></i> Review`;
        }

        // Only auto-close the modal if it's NOT a quiz. 
        // For quizzes, the user clicks the "Return to Dashboard" button they just received.
        if (modType !== 'quiz') {
            lessonModal.hide();
        }
        
        // Reset the finish button so it's ready for the next modal open
        lessonFinishBtn.disabled = false;
        lessonFinishBtn.innerHTML = `🌟 Complete & Earn XP!`;
        
    } catch (error) {
        console.error("Failed to sync XP:", error);
        lessonFinishBtn.innerHTML = `Error: ${error.message}`;
        lessonFinishBtn.disabled = false;
        alert("Failed to submit: " + error.message);
    }
});

// Logout Handler
logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.href = 'index.html';
    });
});

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

// ==============
// Avatar System
// ==============

function updateNavAvatar() {
    const navIcon = document.getElementById('nav-equipped-avatar');
    if (!navIcon) return;
    const avatar = AVATAR_ROSTER.find(a => a.id === equippedAvatar) || AVATAR_ROSTER[0];
    navIcon.textContent = avatar.icon;
}

function renderAvatarShop() {
    const grid = document.getElementById('avatar-grid');
    const coinsDisplay = document.getElementById('shop-coins-display');
    if (!grid || !coinsDisplay) return;

    coinsDisplay.textContent = currentXP + ' 🪙';

    grid.innerHTML = AVATAR_ROSTER.map(avatar => {
        const isUnlocked = unlockedAvatars.includes(avatar.id);
        const isEquipped = equippedAvatar === avatar.id;
        
        let statusBadge = '';
        if (isEquipped) statusBadge = `<span class="badge bg-success position-absolute top-0 end-0 m-2"><i class="bi bi-check-circle"></i></span>`;
        else if (isUnlocked) statusBadge = `<span class="badge bg-secondary position-absolute top-0 end-0 m-2">Owned</span>`;
        else statusBadge = `<span class="badge bg-dark border border-secondary position-absolute top-0 end-0 m-2"><i class="bi bi-lock-fill text-warning"></i> ${avatar.cost}</span>`;

        const borderClass = shopSelectedAvatarId === avatar.id ? 'border-primary border-2' : 'border-secondary';
        const opacityClass = isUnlocked ? '' : 'opacity-50';

        return `
            <div class="col-4 col-sm-3">
                <div class="card bg-dark text-white cursor-pointer avatar-card position-relative ${borderClass} h-100" data-id="${avatar.id}">
                    ${statusBadge}
                    <div class="card-body text-center p-2 d-flex flex-column align-items-center justify-content-center ${opacityClass}">
                        <div style="font-size: 2.5rem; line-height: 1;">${avatar.icon}</div>
                        <small class="d-block mt-2 text-truncate w-100" style="font-size: 0.75rem;">${avatar.name}</small>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Update Left Preview Panel
    const previewIcon = document.getElementById('avatar-preview-icon');
    const previewName = document.getElementById('avatar-preview-name');
    const previewStatus = document.getElementById('avatar-preview-status');
    const btnSave = document.getElementById('btn-save-avatar');

    if (previewIcon && previewName && btnSave && shopSelectedAvatarId) {
        const selected = AVATAR_ROSTER.find(a => a.id === shopSelectedAvatarId) || AVATAR_ROSTER[0];
        previewIcon.textContent = selected.icon;
        previewName.textContent = selected.name;
        
        const isUnlocked = unlockedAvatars.includes(shopSelectedAvatarId);
        const isEquipped = equippedAvatar === shopSelectedAvatarId;

        if (isEquipped) {
            previewStatus.innerHTML = `<span class="text-success"><i class="bi bi-check-circle"></i> Equipped</span>`;
            btnSave.disabled = true;
            btnSave.className = 'btn btn-success fw-bold';
            btnSave.textContent = 'Equipped';
        } else if (isUnlocked) {
            previewStatus.innerHTML = `<span class="text-info">Owned</span>`;
            btnSave.disabled = false;
            btnSave.className = 'btn btn-primary fw-bold';
            btnSave.textContent = 'Equip Avatar';
        } else {
            previewStatus.innerHTML = `<span class="text-warning"><i class="bi bi-lock-fill"></i> Cost: ${selected.cost} 🪙</span>`;
            btnSave.disabled = currentXP < selected.cost;
            btnSave.className = 'btn btn-warning text-dark fw-bold';
            btnSave.textContent = `Buy for ${selected.cost} 🪙`;
        }
    }

    // Attach click events
    document.querySelectorAll('.avatar-card').forEach(card => {
        card.addEventListener('click', () => {
            shopSelectedAvatarId = card.getAttribute('data-id');
            renderAvatarShop();
        });
    });
}

// Event Listeners for Shop
const avatarMenuTriggers = document.querySelectorAll('[data-bs-target="#avatarModal"]');
avatarMenuTriggers.forEach(el => {
    el.addEventListener('click', () => {
        shopSelectedAvatarId = equippedAvatar; // Default to currently equipped
        renderAvatarShop();
    });
});

const btnSaveAvatar = document.getElementById('btn-save-avatar');
if (btnSaveAvatar) {
    btnSaveAvatar.addEventListener('click', async () => {
        const selected = AVATAR_ROSTER.find(a => a.id === shopSelectedAvatarId);
        if (!selected) return;

        btnSaveAvatar.disabled = true;
        btnSaveAvatar.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Processing...`;

        try {
            const isUnlocked = unlockedAvatars.includes(shopSelectedAvatarId);
            let payload = {};

            if (isUnlocked) {
                // Just Equip
                equippedAvatar = shopSelectedAvatarId;
                payload = { equippedAvatar: equippedAvatar };
            } else {
                // Buy
                if (currentXP < selected.cost) throw new Error("Not enough coins!");
                currentXP -= selected.cost;
                unlockedAvatars.push(shopSelectedAvatarId);
                equippedAvatar = shopSelectedAvatarId;
                
                payload = {
                    xp: currentXP,
                    unlockedAvatars: unlockedAvatars,
                    equippedAvatar: equippedAvatar
                };
            }

            // Sync to firestore
            await updateDoc(userDocRef, payload);
            
            // Update UI globally
            updateNavAvatar();
            xpPoints.textContent = currentXP;
            renderAvatarShop();
            
            showToast("Avatar Updated", `You are now using the ${selected.name} avatar!`);
        } catch (err) {
            console.error(err);
            alert(err.message);
            renderAvatarShop(); // Reset btn
        }
    });
}
