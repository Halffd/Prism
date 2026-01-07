import mongoose from 'mongoose';
import connectToDatabase from '../utils/db';

// Define the database connection function
export const getDb = async () => {
  try {
    const connection = await connectToDatabase();
    return connection.connection.db;
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
};

// Ensure the connection is established
export const initDb = async () => {
  try {
    await connectToDatabase();
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
};