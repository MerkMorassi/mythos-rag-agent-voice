import React, { useState, useEffect } from 'react';
import { 
    loginWithEmail, 
    registerWithEmail, 
    loginWithGoogle, 
    logoutUser, 
    sendPasswordReset, 
    onAuthChange 
} from '../services/firebase';
import { User } from 'firebase/auth';

interface AuthManagerProps {
    onUserChange: (user: User | null) => void;
}

export const AuthManager: React.FC<AuthManagerProps> = ({ onUserChange }) => {
    const [user, setUser] = useState<User | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isRegister, setIsRegister] = useState(false);
    const [isReset, setIsReset] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthChange((currentUser) => {
            setUser(currentUser);
            onUserChange(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [onUserChange]);

    const handleAuthAction = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setInfo(null);

        if (!email.trim() || (!isReset && !password.trim())) {
            setError("Email and Password are required.");
            return;
        }

        try {
            if (isReset) {
                await sendPasswordReset(email);
                setInfo("Password reset link sent! Check your inbox.");
                setIsReset(false);
            } else if (isRegister) {
                if (password !== confirmPassword) {
                    setError("Passwords do not match.");
                    return;
                }
                await registerWithEmail(email, password);
                setInfo("Registration successful! Welcome to MythOS.");
            } else {
                await loginWithEmail(email, password);
                setInfo("Secure access granted.");
            }
        } catch (err: any) {
            console.error("Auth action error:", err);
            let errMsg = err.message || "An authentication error occurred.";
            if (errMsg.includes("auth/invalid-credential") || errMsg.includes("auth/wrong-password")) {
                errMsg = "Invalid email or password. Please verify your credentials.";
            } else if (errMsg.includes("auth/email-already-in-use")) {
                errMsg = "This email is already registered.";
            } else if (errMsg.includes("auth/weak-password")) {
                errMsg = "Password should be at least 6 characters.";
            } else if (errMsg.includes("auth/invalid-email")) {
                errMsg = "Please enter a valid email address.";
            } else if (errMsg.includes("auth/user-not-found")) {
                errMsg = "No user found with this email.";
            }
            setError(errMsg);
        }
    };

    const handleGoogleSignIn = async () => {
        setError(null);
        setInfo(null);
        try {
            await loginWithGoogle();
            setInfo("Secure Google access granted.");
        } catch (err: any) {
            console.error("Google Auth error:", err);
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(err.message || "Failed to authenticate with Google.");
            }
        }
    };

    const handleLogout = async () => {
        try {
            await logoutUser();
            setUser(null);
            onUserChange(null);
            setInfo("Securely logged out.");
        } catch (err: any) {
            setError("Failed to logout safely.");
        }
    };

    if (loading) {
        return (
            <div style={{ position: 'fixed', inset: 0, background: '#050505', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                <div style={{ width: '40px', height: '40px', border: '2px solid #333', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '1rem' }} />
                <div style={{ fontFamily: 'Menlo, monospace', fontSize: '0.75rem', color: '#666', letterSpacing: '2px' }}>INITIALIZING SECURE SESSION...</div>
                <style>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    if (user) {
        // Render top profile toolbar component when user is logged in
        return (
            <div className="flex-group" style={{ gap: '0.75rem', background: 'rgba(255,255,255,0.02)', padding: '4px 10px', borderRadius: '4px', border: '1px solid #222' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold' }}>SECURE COG</div>
                    <div style={{ fontSize: '0.75rem', color: '#38bdf8', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={user.email || 'Authenticated User'}>
                        {user.email}
                    </div>
                </div>
                <button onClick={handleLogout} className="btn btn-secondary btn-xs" style={{ borderColor: '#f87171', color: '#f87171', height: '1.75rem' }} title="Terminate Active Session">
                    LOGOUT
                </button>
            </div>
        );
    }

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5, 5, 5, 0.96)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9990, backdropFilter: 'blur(8px)' }}>
            <div className="section-panel" style={{ width: '420px', padding: '2.5rem', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', boxShadow: '0 10px 40px rgba(0,0,0,0.8)' }}>
                {/* CYBERNETIC LOGO HEADER */}
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#a78bfa', letterSpacing: '4px', marginBottom: '0.25rem' }}>MYTHOS DMS</div>
                    <div style={{ fontSize: '0.65rem', color: '#666', letterSpacing: '3px', textTransform: 'uppercase' }}>SECURE GATEWAY v3.7.2</div>
                </div>

                {error && (
                    <div style={{ background: 'rgba(248, 113, 113, 0.08)', border: '1px solid #f87171', color: '#f87171', fontSize: '0.8rem', padding: '0.75rem', borderRadius: '4px', marginBottom: '1.25rem', fontFamily: 'Menlo, monospace' }}>
                        ERR: {error}
                    </div>
                )}

                {info && (
                    <div style={{ background: 'rgba(74, 222, 128, 0.08)', border: '1px solid #4ade80', color: '#4ade80', fontSize: '0.8rem', padding: '0.75rem', borderRadius: '4px', marginBottom: '1.25rem', fontFamily: 'Menlo, monospace' }}>
                        SYS: {info}
                    </div>
                )}

                <form onSubmit={handleAuthAction} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <label style={{ fontSize: '0.7rem', color: '#888', letterSpacing: '1px', textTransform: 'uppercase' }}>User Identifier (Email)</label>
                        <input 
                            type="email" 
                            className="unified-input"
                            style={{ width: '100%', height: '2.5rem', background: '#000', border: '1px solid #333', color: '#fff', padding: '0 0.75rem', borderRadius: '4px' }}
                            placeholder="operator@mythos.net"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    {!isReset && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label style={{ fontSize: '0.7rem', color: '#888', letterSpacing: '1px', textTransform: 'uppercase' }}>Access Code (Password)</label>
                                {!isRegister && (
                                    <span 
                                        onClick={() => { setIsReset(true); setError(null); }} 
                                        style={{ fontSize: '0.7rem', color: '#facc15', cursor: 'pointer', opacity: 0.8 }}
                                    >
                                        Forgot Access Code?
                                    </span>
                                )}
                            </div>
                            <input 
                                type="password" 
                                className="unified-input"
                                style={{ width: '100%', height: '2.5rem', background: '#000', border: '1px solid #333', color: '#fff', padding: '0 0.75rem', borderRadius: '4px' }}
                                placeholder="••••••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required={!isReset}
                            />
                        </div>
                    )}

                    {isRegister && !isReset && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <label style={{ fontSize: '0.7rem', color: '#888', letterSpacing: '1px', textTransform: 'uppercase' }}>Confirm Access Code</label>
                            <input 
                                type="password" 
                                className="unified-input"
                                style={{ width: '100%', height: '2.5rem', background: '#000', border: '1px solid #333', color: '#fff', padding: '0 0.75rem', borderRadius: '4px' }}
                                placeholder="••••••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>
                    )}

                    <button 
                        type="submit" 
                        className="btn" 
                        style={{ height: '2.75rem', background: '#a78bfa', color: '#000', fontWeight: 'bold', border: 'none', borderRadius: '4px', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '2px', transition: 'opacity 0.2s' }}
                    >
                        {isReset ? "Request Reset" : (isRegister ? "Establish Terminal Access" : "Grant Access")}
                    </button>
                </form>

                {/* GOOGLE SIGN IN */}
                {!isReset && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', margin: '1.5rem 0', gap: '1rem' }}>
                            <div style={{ flex: 1, height: '1px', background: '#222' }} />
                            <span style={{ fontSize: '0.65rem', color: '#444', letterSpacing: '1px' }}>OR CHOOSE FEDERATED</span>
                            <div style={{ flex: 1, height: '1px', background: '#222' }} />
                        </div>

                        <button 
                            type="button"
                            onClick={handleGoogleSignIn}
                            className="btn btn-secondary" 
                            style={{ width: '100%', height: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '1px' }}
                        >
                            <svg style={{ width: '16px', height: '16px' }} viewBox="0 0 24 24">
                                <path fill="currentColor" d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.6h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.4c0,-0.64 -0.06,-1.27 -0.16,-2H21.35z" />
                                <path fill="currentColor" d="M12,20.7c2.6,0 4.8,-0.8 6.4,-2.3l-3.3,-2.6c-0.9,0.6 -2.1,1 -3.1,1c-2.4,0 -4.5,-1.6 -5.2,-3.9H3.35v2.7C4.95,18.7 8.2,20.7 12,20.7z" />
                                <path fill="currentColor" d="M6.8,12.9c-0.1,-0.4 -0.2,-0.9 -0.2,-1.4s0.1,-1 0.2,-1.4V7.4H3.35C2.8,8.5 2.5,9.7 2.5,11s0.3,2.5 0.85,3.6L6.8,12.9z" />
                                <path fill="currentColor" d="M12,5.3c1.4,0 2.7,0.5 3.7,1.4l2.8,-2.8C16.8,2.4 14.6,1.5 12,1.5C8.2,1.5 4.9,3.5 3.35,6.2L6.8,8.9C7.5,6.6 9.6,5.3 12,5.3z" />
                            </svg>
                            Sign In with Google
                        </button>
                    </>
                )}

                {/* TOGGLING AUTH MODE */}
                <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem' }}>
                    {isReset ? (
                        <span 
                            onClick={() => { setIsReset(false); setError(null); }} 
                            style={{ color: '#a78bfa', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                            Back to Secure Login
                        </span>
                    ) : isRegister ? (
                        <span style={{ color: '#666' }}>
                            Already registered?{" "}
                            <span 
                                onClick={() => { setIsRegister(false); setError(null); }} 
                                style={{ color: '#a78bfa', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                                Grant Access
                            </span>
                        </span>
                    ) : (
                        <span style={{ color: '#666' }}>
                            Need secure operator access?{" "}
                            <span 
                                onClick={() => { setIsRegister(true); setError(null); }} 
                                style={{ color: '#a78bfa', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                                Establish Terminal Access
                            </span>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};
