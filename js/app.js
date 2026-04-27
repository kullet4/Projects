// Main Application Logic including PWA Registration

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// ===== DEPED GRADING SYSTEM LOGIC (OPTIMIZED FOR ZERO-READ CALCULATION) =====
// Added for Phase 2: Core Gamification & Progress Tracking

const DEPED_WEIGHTS = {
    // English, Filipino, Mother Tongue, AP, EsP
    LANGUAGE_AP_ESP: { ww: 0.30, pt: 0.50, qa: 0.20 },
    // Science, Math
    MATH_SCIENCE: { ww: 0.40, pt: 0.40, qa: 0.20 },
    // MAPEH, EPP / TLE
    MAPEH_EPP: { ww: 0.20, pt: 0.60, qa: 0.20 }
};

class DepEdGrader {
    /**
     * Calculates the Transmuted Grade and Descriptor locally
     * @param {Object} scores - { wwRaw, wwMax, ptRaw, ptMax, qaRaw, qaMax }
     * @param {Object} weightTrack - e.g. DEPED_WEIGHTS.MATH_SCIENCE
     */
    static calculateGrade(scores, weightTrack) {
        // 1. Percentage Calculation
        const wwPercent = scores.wwMax > 0 ? (scores.wwRaw / scores.wwMax) * 100 : 0;
        const ptPercent = scores.ptMax > 0 ? (scores.ptRaw / scores.ptMax) * 100 : 0;
        const qaPercent = scores.qaMax > 0 ? (scores.qaRaw / scores.qaMax) * 100 : 0;

        // 2. Apply Weights (Weighted Scores)
        const wwWeighted = wwPercent * weightTrack.ww;
        const ptWeighted = ptPercent * weightTrack.pt;
        const qaWeighted = qaPercent * weightTrack.qa;

        // 3. Initial Grade
        const initialGrade = wwWeighted + ptWeighted + qaWeighted;

        // 4. Transmutation (DepEd standard)
        let transmutedGrade = 0;
        if (initialGrade >= 60) {
            transmutedGrade = 75 + ((initialGrade - 60) * 0.625);
        } else {
            transmutedGrade = 60 + (initialGrade * 0.25);
        }
        
        // Round to whole number matching standard DepEd rounding
        transmutedGrade = Math.round(transmutedGrade); 

        // 5. Formulate Descriptor (2026 Update)
        let descriptor = "Did Not Meet Expectations";
        if (transmutedGrade >= 90) descriptor = "Advancing (Outstanding)";
        else if (transmutedGrade >= 85) descriptor = "Very Satisfactory";
        else if (transmutedGrade >= 80) descriptor = "Satisfactory";
        else if (transmutedGrade >= 75) descriptor = "Fairly Satisfactory";

        return {
            initialGrade: initialGrade.toFixed(2),
            transmutedGrade: transmutedGrade,
            descriptor: descriptor,
            breakdown: { 
                ww: wwWeighted.toFixed(2), 
                pt: ptWeighted.toFixed(2), 
                qa: qaWeighted.toFixed(2) 
            }
        };
    }
}

// Make globally available so student.js and teacher.js can calculate on the fly
window.DEPED_WEIGHTS = DEPED_WEIGHTS;
window.DepEdGrader = DepEdGrader;
