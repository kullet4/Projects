import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    sendPasswordResetEmail,
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const authSection = document.getElementById('auth-section');

// Render Login Form
function renderLoginForm() {
    authSection.innerHTML = `
        <div class="bubbly-card mx-auto p-3 p-sm-4 p-md-5" style="max-width: 420px;">
            <div class="mb-4">
                <h2 class="text-dark fw-bold mb-1 fs-3 fs-md-2">Log in! 👋</h2>
                <p class="text-muted fw-bold small fs-sm-6">Ready to learn and play?</p>
            </div>
            
            <form id="auth-form">
                <div class="mb-3 text-start">
                    <input type="email" class="form-control bubbly-input w-100 fs-6" id="email" placeholder="Email Address" required>
                </div>
                <div class="mb-3 text-start">
                    <input type="password" class="form-control bubbly-input w-100 fs-6" id="password" placeholder="Password" required>
                </div>
                
                <div id="login-error" class="text-danger fw-bold mb-3 d-none bg-danger bg-opacity-10 p-2 rounded-3 text-center small"></div>
                <div id="reset-success" class="text-success fw-bold small mb-3 d-none bg-success bg-opacity-10 p-2 rounded-3 text-center">Password reset email sent!</div>
                
                <button id="login-submit-btn" type="submit" class="btn-duo-primary fs-5 mt-2">Let's Go! 🚀</button>
                <div class="text-center mt-3">
                    <button type="button" id="forgot-password-btn" class="btn btn-link text-decoration-none fw-bold text-secondary small p-0" data-bs-toggle="modal" data-bs-target="#forgotPasswordModal">I forgot my password!</button>
                </div>
            </form>
        </div>
    `;

    // Form Submit (Login)
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('login-error');
        const submitBtn = document.getElementById('login-submit-btn');
        
        try {
            errorDiv.classList.add('d-none');
            const successDiv = document.getElementById('reset-success');
            if(successDiv) successDiv.classList.add('d-none');
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'Signing In...';
            
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
            
            let displayError = error.message;
            if (error.code === 'auth/invalid-credential') displayError = "Incorrect email or password.";
            errorDiv.textContent = displayError;
            errorDiv.classList.remove('d-none');
        }
    });

    // Password Reset
    const resetForm = document.getElementById('reset-password-form');
    if (resetForm) {
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const resetEmail = document.getElementById('reset-email').value;
            const resetMsg = document.getElementById('reset-msg');
            const submitResetBtn = document.getElementById('submit-reset-btn');

            submitResetBtn.disabled = true;
            submitResetBtn.textContent = 'Sending...';

            try {
                await sendPasswordResetEmail(auth, resetEmail);
                resetMsg.className = 'small mb-3 text-success';
                resetMsg.textContent = 'Success! A password reset link has been sent to your email inbox.';
                resetForm.reset();
            } catch (error) {
                resetMsg.className = 'small mb-3 text-danger';
                resetMsg.textContent = error.message;
            } finally {
                submitResetBtn.disabled = false;
                submitResetBtn.textContent = 'Send Reset Link';
            }
        });
    }
}

// Handle Routing Details on Login
async function routeUserBasedOnRole(user, retryCount = 0) {
    try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const role = userData.role || 'unassigned';

            // Automatic seamless routing
            if (role === 'student') {
                window.location.replace('student-dashboard.html');
            } else if (role === 'teacher') {
                window.location.replace('teacher-dashboard.html');
            } else if (role === 'admin') {
                window.location.replace('admin-dashboard.html');
            } else {
                authSection.innerHTML = `<div class="card p-4 mt-4"><p class="text-danger mb-3 fw-bold">Error: Role is unassigned or misspelled.</p><button id="logout-btn" class="btn btn-outline-danger">Log Out</button></div>`;
                document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
            }
            
        } else {
            if (retryCount < 3) {
                console.log(`Document missing, retrying... (${retryCount + 1})`);
                setTimeout(() => routeUserBasedOnRole(user, retryCount + 1), 1000);
            } else {
                console.log("No such user document!");
                authSection.innerHTML = `<p class="text-danger mt-3">User role not found. Please contact an admin.</p>
                 <button id="logout-btn" class="btn btn-danger mt-2">Log Out</button>`;
                 document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
            }
        }
    } catch (error) {
         console.error("Error fetching user role:", error);
         authSection.innerHTML = `<p class="text-danger">Error loading dashboard.</p>`;
    }
}

// Authentication State Observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is signed in.
        authSection.innerHTML = `<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p>Verifying role...</p>`;
        routeUserBasedOnRole(user);
    } else {
        // User is signed out.
        renderLoginForm();
    }
});