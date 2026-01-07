import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';
import { User } from '../models/mongo-schemas';

const JWT_SECRET = process.env.JWT_SECRET || 'prism-demo-secret';

// Initialize Firebase Admin SDK if credentials are available
if (!admin.apps.length) {
  try {
    // Use service account from environment variable if available
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      // For development, just initialize without credentials (will restrict functionality)
      admin.initializeApp();
    }
  } catch (error) {
    console.warn('Firebase Admin SDK initialization failed:', error);
    // Initialize without credentials for development
    admin.initializeApp();
  }
}

interface JwtPayload {
  userId: string;
  email: string;
  exp: number;
  iat: number;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Extract token from header
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      // For demo purposes, allow anonymous access but don't set a user
      return next();
    }

    // First, try to verify as a Firebase ID token
    let decodedFirebaseUser;
    try {
      decodedFirebaseUser = await admin.auth().verifyIdToken(token);
    } catch (firebaseError) {
      // If Firebase token verification fails, fall back to JWT verification
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

        // Find user in database
        const user = await User.findById(decoded.userId);
        if (!user) {
          return res.status(401).json({
            success: false,
            error: 'User not found'
          });
        }

        req.user = {
          id: user._id.toString(),
          email: user.email,
          name: user.name
        };

        return next();
      } catch (jwtError) {
        console.error('Authentication error - both Firebase and JWT verification failed:', firebaseError, jwtError);
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token'
        });
      }
    }

    // If Firebase token verification succeeds
    // Create or update user in database based on Firebase user
    let user = await User.findOne({ externalId: decodedFirebaseUser.uid });

    if (!user) {
      // Create new user if doesn't exist
      user = new User({
        externalId: decodedFirebaseUser.uid,
        email: decodedFirebaseUser.email,
        name: decodedFirebaseUser.name || decodedFirebaseUser.email?.split('@')[0] || 'Anonymous User',
        password: '' // No password for Firebase-authenticated users
      });
      await user.save();
    } else {
      // Update user info if needed
      user.email = decodedFirebaseUser.email;
      user.name = decodedFirebaseUser.name || decodedFirebaseUser.email?.split('@')[0] || 'Anonymous User';
      await user.save();
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name
    };

    next();
  } catch (error: any) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
};

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Extract token from header
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // First, try to verify as a Firebase ID token
    let decodedFirebaseUser;
    try {
      decodedFirebaseUser = await admin.auth().verifyIdToken(token);
    } catch (firebaseError) {
      // If Firebase token verification fails, fall back to JWT verification
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

        // Find user in database
        const user = await User.findById(decoded.userId);
        if (!user) {
          return res.status(401).json({
            success: false,
            error: 'User not found'
          });
        }

        req.user = {
          id: user._id.toString(),
          email: user.email,
          name: user.name
        };

        return next();
      } catch (jwtError) {
        console.error('Authentication error - both Firebase and JWT verification failed:', firebaseError, jwtError);
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token'
        });
      }
    }

    // If Firebase token verification succeeds
    // Create or update user in database based on Firebase user
    let user = await User.findOne({ externalId: decodedFirebaseUser.uid });

    if (!user) {
      // Create new user if doesn't exist
      user = new User({
        externalId: decodedFirebaseUser.uid,
        email: decodedFirebaseUser.email,
        name: decodedFirebaseUser.name || decodedFirebaseUser.email?.split('@')[0] || 'Anonymous User',
        password: '' // No password for Firebase-authenticated users
      });
      await user.save();
    } else {
      // Update user info if needed
      user.email = decodedFirebaseUser.email;
      user.name = decodedFirebaseUser.name || decodedFirebaseUser.email?.split('@')[0] || 'Anonymous User';
      await user.save();
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name
    };

    return next();
  } catch (error: any) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
};