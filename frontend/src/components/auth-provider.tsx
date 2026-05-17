"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import {
  AuthCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';

import { auth } from '@/lib/firebase';

type PendingCredentialLink = {
  id: string;
  email: string;
  signInMethods: string[];
  providerId: string;
  credential: {
    providerId: string;
    signInMethod: string;
    accessToken?: string | null;
    idToken?: string | null;
  };
  expiresAt: number;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  pendingCredentialLink: PendingCredentialLink | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  linkGoogleToCurrentUser: () => Promise<void>;
  linkPasswordToCurrentUser: (password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const PENDING_LINK_STORAGE_KEY = 'pixlvault.pendingCredentialLink';
const PENDING_LINK_TTL_MS = 10 * 60 * 1000;

function readPendingCredentialLink(): PendingCredentialLink | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(PENDING_LINK_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PendingCredentialLink;
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
      window.localStorage.removeItem(PENDING_LINK_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    window.localStorage.removeItem(PENDING_LINK_STORAGE_KEY);
    return null;
  }
}

function writePendingCredentialLink(value: PendingCredentialLink | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!value) {
    window.localStorage.removeItem(PENDING_LINK_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(PENDING_LINK_STORAGE_KEY, JSON.stringify(value));
}

function toGoogleCredentialData(credential: AuthCredential) {
  const oauthCredential = credential as AuthCredential & { accessToken?: string | null; idToken?: string | null };
  return {
    providerId: credential.providerId,
    signInMethod: credential.signInMethod ?? 'google.com',
    accessToken: oauthCredential.accessToken ?? null,
    idToken: oauthCredential.idToken ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCredentialLink, setPendingCredentialLink] = useState<PendingCredentialLink | null>(null);
  const linkingInProgressRef = useRef(false);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setLoading(false);
  }), []);

  useEffect(() => {
    setPendingCredentialLink(readPendingCredentialLink());
  }, []);

  const linkPendingCredentialIfNeeded = async () => {
    if (!pendingCredentialLink || !auth.currentUser) {
      return;
    }

    if (pendingCredentialLink.email && auth.currentUser.email && pendingCredentialLink.email.toLowerCase() !== auth.currentUser.email.toLowerCase()) {
      return;
    }

    if (linkingInProgressRef.current) {
      return;
    }

    linkingInProgressRef.current = true;

    try {
      if (pendingCredentialLink.expiresAt < Date.now()) {
        throw new Error('The pending provider-link session expired. Please try again.');
      }

      let credential: AuthCredential;
      if (pendingCredentialLink.providerId === 'google.com') {
        credential = GoogleAuthProvider.credential(
          pendingCredentialLink.credential.idToken ?? null,
          pendingCredentialLink.credential.accessToken ?? null,
        );
      } else {
        throw new Error(`Unsupported pending provider: ${pendingCredentialLink.providerId}`);
      }

      await linkWithCredential(auth.currentUser, credential);
      setPendingCredentialLink(null);
      writePendingCredentialLink(null);
    } finally {
      linkingInProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (user && pendingCredentialLink) {
      void linkPendingCredentialIfNeeded();
    }
  }, [pendingCredentialLink, user]);

  const getFriendlyProviderMessage = (signInMethods: string[]) => {
    if (signInMethods.includes('password')) {
      return 'This email already belongs to an email/password account. Sign in with email/password to link Google to the same Firebase UID.';
    }

    if (signInMethods.includes('google.com')) {
      return 'This email already belongs to a Google account. Sign in with Google to keep the same Firebase UID and add email/password later if needed.';
    }

    return `This email is already linked to: ${signInMethods.join(', ')}.`;
  };

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      await linkPendingCredentialIfNeeded();
    } catch (error) {
      const firebaseError = error as FirebaseError & { customData?: { email?: string } };
      if (firebaseError.code === 'auth/account-exists-with-different-credential') {
        const email = firebaseError.customData?.email;
        const credential = GoogleAuthProvider.credentialFromError(error as never);

        if (email && credential) {
          const signInMethods = await fetchSignInMethodsForEmail(auth, email);
          const pendingLink: PendingCredentialLink = {
            id: crypto.randomUUID(),
            email,
            signInMethods,
            providerId: 'google.com',
            credential: toGoogleCredentialData(credential),
            expiresAt: Date.now() + PENDING_LINK_TTL_MS,
          };
          setPendingCredentialLink(pendingLink);
          writePendingCredentialLink(pendingLink);
          throw new Error(getFriendlyProviderMessage(signInMethods));
        }
      }

      if (firebaseError.code === 'auth/credential-already-in-use') {
        throw new Error('This Google account is already linked to another Firebase UID. Sign in with the existing provider for that account first.');
      }

      throw new Error(firebaseError.message ?? 'Google sign-in failed.');
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await linkPendingCredentialIfNeeded();
    } catch (error) {
      const firebaseError = error as FirebaseError;

      const recoverWithMethods = async () => {
        const signInMethods = await fetchSignInMethodsForEmail(auth, email);
        if (signInMethods.includes('google.com')) {
          throw new Error('This account uses Google Sign-In. Continue with Google to access the same Firebase UID.');
        }
        if (signInMethods.includes('password')) {
          throw new Error('Incorrect email/password. Please try again.');
        }
        throw new Error(getFriendlyProviderMessage(signInMethods));
      };

      if (
        firebaseError.code === 'auth/user-not-found' ||
        firebaseError.code === 'auth/wrong-password' ||
        firebaseError.code === 'auth/invalid-credential' ||
        firebaseError.code === 'auth/invalid-login-credentials'
      ) {
        await recoverWithMethods();
      }

      throw new Error(firebaseError.message ?? 'Email sign-in failed.');
    }
  };

  const signUpWithEmail = async (email: string, password: string, displayName?: string) => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName?.trim()) {
        await updateProfile(result.user, { displayName: displayName.trim() });
      }
      await linkPendingCredentialIfNeeded();
    } catch (error) {
      const firebaseError = error as FirebaseError;
      if (firebaseError.code === 'auth/email-already-in-use') {
        const methods = await fetchSignInMethodsForEmail(auth, email);
        throw new Error(getFriendlyProviderMessage(methods));
      }

      throw new Error(firebaseError.message ?? 'Email sign-up failed.');
    }
  };

  const sendPasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      const firebaseError = error as FirebaseError;
      throw new Error(firebaseError.message ?? 'Could not send password reset email.');
    }
  };

  const linkGoogleToCurrentUser = async () => {
    if (!auth.currentUser) {
      throw new Error('Sign in first before linking Google.');
    }

    try {
      await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
    } catch (error) {
      const firebaseError = error as FirebaseError & { customData?: { email?: string } };
      if (firebaseError.code === 'auth/credential-already-in-use') {
        const email = firebaseError.customData?.email ?? auth.currentUser.email ?? '';
        if (email) {
          const signInMethods = await fetchSignInMethodsForEmail(auth, email);
          throw new Error(getFriendlyProviderMessage(signInMethods));
        }
        throw new Error('This Google account is already linked to another Firebase UID. Sign in with the existing account first.');
      }

      throw new Error(firebaseError.message ?? 'Could not link Google to the current account.');
    }
  };

  const linkPasswordToCurrentUser = async (password: string) => {
    if (!auth.currentUser?.email) {
      throw new Error('Current user does not have an email address to link.');
    }

    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      await linkWithCredential(auth.currentUser, credential);
    } catch (error) {
      const firebaseError = error as FirebaseError;
      if (firebaseError.code === 'auth/email-already-in-use' || firebaseError.code === 'auth/credential-already-in-use') {
        const signInMethods = await fetchSignInMethodsForEmail(auth, auth.currentUser.email);
        throw new Error(getFriendlyProviderMessage(signInMethods));
      }

      throw new Error(firebaseError.message ?? 'Could not add password login to this account.');
    }
  };

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    pendingCredentialLink,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    linkGoogleToCurrentUser,
    linkPasswordToCurrentUser,
    signOutUser: async () => {
      setPendingCredentialLink(null);
      writePendingCredentialLink(null);
      await signOut(auth);
    },
    getIdToken: async () => {
      if (!auth.currentUser) {
        return null;
      }
      return auth.currentUser.getIdToken();
    },
  }), [loading, pendingCredentialLink, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
