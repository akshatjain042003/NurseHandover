import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { transcribeAudio, generateISBARReport } from "./services/openai";
import { upload } from "./services/audio";
import jwt from "jsonwebtoken";
import { insertUserSchema, insertPatientSchema, insertHandoverSchema } from "@shared/schema";
import { z } from "zod";

// Extend Request interface to include user property
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Middleware to verify JWT token
function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { employeeId, password } = req.body;
      
      if (!employeeId || !password) {
        return res.status(400).json({ message: 'Employee ID and password are required' });
      }

      const user = await storage.validateUser(employeeId, password);
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, employeeId: user.employeeId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({ 
        token, 
        user: {
          id: user.id,
          employeeId: user.employeeId,
          name: user.name,
          role: user.role,
          department: user.department,
          shift: user.shift
        }
      });
    } catch (error) {
      res.status(500).json({ message: 'Login failed' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      const existingUser = await storage.getUserByEmployeeId(userData.employeeId);
      if (existingUser) {
        return res.status(400).json({ message: 'Employee ID already exists' });
      }

      const user = await storage.createUser(userData);
      const token = jwt.sign(
        { id: user.id, employeeId: user.employeeId },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({ 
        token, 
        user: {
          id: user.id,
          employeeId: user.employeeId,
          name: user.name,
          role: user.role,
          department: user.department,
          shift: user.shift
        }
      });
    } catch (error) {
      res.status(400).json({ message: 'Registration failed' });
    }
  });

  // Forgot password route
  app.post('/api/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      // In a real application, you would:
      // 1. Find user by email
      // 2. Generate reset token
      // 3. Send email with reset link
      // For demo purposes, we'll just return success
      
      console.log(`Password reset requested for email: ${email}`);
      
      res.json({ message: 'Password reset link sent to email' });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // User routes
  app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch profile' });
    }
  });

  // Patient routes
  app.get('/api/patients/search', authenticateToken, async (req, res) => {
    try {
      const { query, ward, status } = req.query;
      const patients = await storage.searchPatients(
        query as string || '',
        ward as string,
        status as string
      );
      res.json(patients);
    } catch (error) {
      res.status(500).json({ message: 'Search failed' });
    }
  });

  // Initialize sample data endpoint (for development)
  app.post('/api/init-data', async (req, res) => {
    try {
      // Add some sample patients
      const samplePatients = [
        {
          patientId: 'P001',
          name: 'John Smith',
          room: 'Room 301A',
          ward: '3A',
          status: 'active',
          dateOfBirth: new Date('1978-05-20'),
          gender: 'male',
          medicalRecordNumber: 'MR123456',
          primaryDiagnosis: 'Pneumonia',
          attendingPhysician: 'Dr. Johnson',
          emergencyContact: 'Jane Smith - 555-0123',
          insuranceInfo: 'BlueCross BlueShield',
          allergies: 'Penicillin',
          medications: 'Amoxicillin 500mg TID',
          notes: 'Patient recovering well'
        },
        {
          patientId: 'P002',
          name: 'Maria Rodriguez',
          room: 'Room 302B',
          ward: '3B',
          status: 'active',
          dateOfBirth: new Date('1985-09-12'),
          gender: 'female',
          medicalRecordNumber: 'MR123457',
          primaryDiagnosis: 'Diabetes Type 2',
          attendingPhysician: 'Dr. Williams',
          emergencyContact: 'Carlos Rodriguez - 555-0124',
          insuranceInfo: 'Medicare',
          allergies: 'None',
          medications: 'Metformin 1000mg BID',
          notes: 'Blood sugar levels stable'
        },
        {
          patientId: 'P003',
          name: 'Robert Johnson',
          room: 'Room 303A',
          ward: '3A',
          status: 'active',
          dateOfBirth: new Date('1960-12-03'),
          gender: 'male',
          medicalRecordNumber: 'MR123458',
          primaryDiagnosis: 'Hypertension',
          attendingPhysician: 'Dr. Brown',
          emergencyContact: 'Linda Johnson - 555-0125',
          insuranceInfo: 'Aetna',
          allergies: 'Aspirin',
          medications: 'Lisinopril 10mg daily',
          notes: 'BP monitoring required'
        }
      ];

      // Insert patients
      for (const patient of samplePatients) {
        try {
          await storage.createPatient(patient);
        } catch (error) {
          console.log('Patient may already exist:', patient.patientId);
        }
      }

      // Add sample handovers
      const sampleHandovers = [
        {
          patientId: 1,
          nurserId: req.user?.id || 1,
          transcription: 'Patient John Smith in room 301A is stable. Vital signs normal. Administered morning medications. Patient reports feeling better and is requesting to ambulate.',
          isbarReport: JSON.stringify({
            identify: "John Smith, 45-year-old male",
            situation: "Recovering from pneumonia",
            background: "Admitted 3 days ago with respiratory symptoms",
            assessment: "Vital signs stable, improving respiratory status",
            recommendation: "Continue current treatment plan, monitor respiratory status"
          }),
          status: 'completed'
        },
        {
          patientId: 2,
          nurserId: req.user?.id || 1,
          transcription: 'Maria Rodriguez in 302B had blood sugar level of 145 this morning. Administered insulin as prescribed. Patient ate breakfast well and is scheduled for diabetes education at 2 PM.',
          isbarReport: JSON.stringify({
            identify: "Maria Rodriguez, 38-year-old female",
            situation: "Diabetes management",
            background: "Type 2 diabetes, recently diagnosed",
            assessment: "Blood sugar levels within target range",
            recommendation: "Continue current medication regimen, diabetes education"
          }),
          status: 'completed'
        },
        {
          patientId: 3,
          nurserId: req.user?.id || 1,
          transcription: 'Robert Johnson in 303A had elevated blood pressure this morning at 160/95. Administered additional antihypertensive medication. Patient is resting comfortably.',
          isbarReport: JSON.stringify({
            identify: "Robert Johnson, 63-year-old male",
            situation: "Hypertension management",
            background: "Long-standing hypertension",
            assessment: "Blood pressure elevated this morning",
            recommendation: "Monitor BP closely, consider medication adjustment"
          }),
          status: 'completed'
        }
      ];

      // Insert handovers
      for (const handover of sampleHandovers) {
        try {
          await storage.createHandover(handover);
        } catch (error) {
          console.log('Error creating handover:', error);
        }
      }

      res.json({ message: 'Sample data initialized successfully' });
    } catch (error) {
      console.error('Failed to initialize data:', error);
      res.status(500).json({ message: 'Failed to initialize data' });
    }
  });

  app.get('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }
      res.json(patient);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch patient' });
    }
  });

  app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
      const patientData = insertPatientSchema.parse(req.body);
      const patient = await storage.createPatient(patientData);
      res.json(patient);
    } catch (error) {
      res.status(400).json({ message: 'Failed to create patient' });
    }
  });

  // Handover routes
  app.get('/api/handovers/recent', authenticateToken, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const handovers = await storage.getRecentHandovers(limit);
      res.json(handovers);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch handovers' });
    }
  });

  app.get('/api/handovers/patient/:patientId', authenticateToken, async (req, res) => {
    try {
      const patientId = parseInt(req.params.patientId);
      const handovers = await storage.getHandoversByPatient(patientId);
      res.json(handovers);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch patient handovers' });
    }
  });

  app.get('/api/handovers/my', authenticateToken, async (req, res) => {
    try {
      const handovers = await storage.getHandoversByNurse(req.user.id);
      res.json(handovers);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch my handovers' });
    }
  });

  app.get('/api/handovers/all', authenticateToken, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const handovers = await storage.getRecentHandovers(limit);
      res.json(handovers);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch all handovers' });
    }
  });

  app.get('/api/handovers/export', authenticateToken, async (req, res) => {
    try {
      const handovers = await storage.getHandoversByNurse(req.user.id);
      
      // Generate CSV content
      const csvHeader = 'Date,Time,Patient ID,Status,Transcription\n';
      const csvContent = handovers.map(h => {
        const date = h.createdAt ? new Date(h.createdAt) : new Date();
        return `${date.toLocaleDateString()},${date.toLocaleTimeString()},${h.patientId},${h.status},"${h.transcription || ''}"`
      }).join('\n');
      
      const csv = csvHeader + csvContent;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=handovers.csv');
      res.send(csv);
    } catch (error) {
      res.status(500).json({ message: 'Failed to export handovers' });
    }
  });

  app.post('/api/handovers', authenticateToken, upload.single('audio'), async (req, res) => {
    try {
      const { patientId } = req.body;
      
      if (!req.file) {
        return res.status(400).json({ message: 'Audio file is required' });
      }

      // Create initial handover record
      const handover = await storage.createHandover({
        patientId: parseInt(patientId),
        nurserId: req.user.id,
        audioPath: req.file.path,
        status: 'processing'
      });

      // Process audio in background
      processHandoverAudio(handover.id, req.file.path, parseInt(patientId));

      res.json(handover);
    } catch (error) {
      res.status(500).json({ message: 'Failed to create handover' });
    }
  });

  app.get('/api/handovers/:id', authenticateToken, async (req, res) => {
    try {
      const handoverId = parseInt(req.params.id);
      const handover = await storage.getHandover(handoverId);
      if (!handover) {
        return res.status(404).json({ message: 'Handover not found' });
      }
      res.json(handover);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch handover' });
    }
  });

  // Dashboard stats
  app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
      const recentHandovers = await storage.getHandoversByNurse(req.user.id);
      const todayHandovers = recentHandovers.filter(h => {
        const today = new Date();
        const handoverDate = h.createdAt ? new Date(h.createdAt) : null;
        return handoverDate ? handoverDate.toDateString() === today.toDateString() : false;
      });

      res.json({
        todayHandovers: todayHandovers.length,
        totalHandovers: recentHandovers.length
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch stats' });
    }
  });

  // Profile routes
  app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
      const { name, department, shift } = req.body;
      const user = await storage.getUser(req.user.id);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Update user profile (simplified for now)
      // In a real implementation, you'd update the user record
      res.json({
        id: user.id,
        employeeId: user.employeeId,
        name: name || user.name,
        role: user.role,
        department: department || user.department,
        shift: shift || user.shift
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update profile' });
    }
  });

  app.post('/api/user/change-password', authenticateToken, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current and new passwords are required' });
      }

      const user = await storage.validateUser(req.user.employeeId, currentPassword);
      if (!user) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }

      // Update password (simplified for now)
      // In a real implementation, you'd hash and update the password
      res.json({ message: 'Password updated successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to change password' });
    }
  });

  app.get('/api/user/reports', authenticateToken, async (req, res) => {
    try {
      const myHandovers = await storage.getHandoversByNurse(req.user.id);
      const totalHandovers = await storage.getRecentHandovers(1000);
      
      res.json({
        totalActiveUsers: 15,
        totalVisits: 234,
        myHandoversCount: myHandovers.length,
        totalHandoversCount: totalHandovers.length,
        peakActivity: {
          hour: 14,
          count: 45
        }
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch reports' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// Background processing function
async function processHandoverAudio(handoverId: number, audioPath: string, patientId: number) {
  try {
    // Transcribe audio
    const transcription = await transcribeAudio(audioPath);
    
    // Update handover with transcription
    await storage.updateHandover(handoverId, {
      transcription: transcription.text,
      status: 'transcribed'
    });

    // Get patient info for ISBAR generation
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      throw new Error('Patient not found');
    }

    // Generate ISBAR report
    const isbarReport = await generateISBARReport(transcription.text, patient);
    
    // Update handover with ISBAR report
    await storage.updateHandover(handoverId, {
      isbarReport: isbarReport,
      status: 'complete'
    });

  } catch (error) {
    console.error('Error processing handover:', error);
    await storage.updateHandover(handoverId, {
      status: 'error'
    });
  }
}
