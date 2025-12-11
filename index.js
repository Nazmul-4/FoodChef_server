const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// --- 1. FIREBASE ADMIN SETUP (SECURITY) ---
const admin = require("firebase-admin");

// This imports the key file you downloaded. 
// Ensure "firebase-admin-service-key.json" is in the SAME folder as this file.
const serviceAccount = require("./firebase-admin-service-key.json"); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
// ------------------------------------------

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection String
const uri = "mongodb+srv://mdnazmulhasan4_db_user:JRy8gGc0JP4hH3N8@cluster0.my3deu2.mongodb.net/?appName=Cluster0";

// Create a MongoClient
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// --- 2. VERIFY TOKEN MIDDLEWARE (SECURITY GUARD) ---
const verifyToken = async (req, res, next) => {
  // 1. Check if authorization header exists
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  // 2. Get the token (remove "Bearer " part)
  const token = req.headers.authorization.split(' ')[1];

  // 3. Verify with Firebase
  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.decodedUser = decodedUser; // Add user info to request
    next(); // Let them pass
  } catch (error) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};
// ---------------------------------------------------

async function run() {
    try {
        // Connect to the database and collections
        const database = client.db("foodchefDB");
        const usersCollection = database.collection("users");
        const mealsCollection = database.collection("meals");
        const reviewsCollection = database.collection("reviews");
        const cartsCollection = database.collection("carts");
        const ordersCollection = database.collection("orders");
        const paymentCollection = database.collection("payments");

        // --- PUBLIC ROUTES (Anyone can see these) ---

        // 1. Get All Meals
        app.get('/meals', async (req, res) => {
            const result = await mealsCollection.find().toArray();
            res.send(result);
        })

        // 2. Get Single Meal Details
        app.get('/meals/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealsCollection.findOne(query);
            res.send(result);
        })

        // 3. Get Top Meals (Sorted by Orders) - NEW ROUTE
        app.get('/meals/top', async (req, res) => {
            const result = await mealsCollection.find().sort({ orders: -1 }).limit(6).toArray();
            res.send(result);
        });

        // 4. Save User on Registration (Must be Public)
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null });
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })


        // --- SECURE ROUTES (Login Required via verifyToken) ---

        // 5. Get All Users (Admin only usually)
        app.get('/users', verifyToken, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // 6. Update User Role
        app.patch('/users/admin/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const role = req.body.role;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { role: role }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // 7. Check if User is Admin
        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.decodedUser.email !== email) return res.status(403).send({ message: 'forbidden' });

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let isAdmin = false;
            if (user) {
                isAdmin = user?.role === 'admin';
            }
            res.send({ admin: isAdmin });
        });

        // 8. Check if User is Chef
        app.get('/users/chef/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (req.decodedUser.email !== email) return res.status(403).send({ message: 'forbidden' });

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let isChef = false;
            if (user) {
                isChef = user?.role === 'chef';
            }
            res.send({ chef: isChef });
        });

        // --- CHEF ROUTES (Protected) ---

        // 9. Add a New Meal
        app.post('/meals', verifyToken, async (req, res) => {
            const item = req.body;
            const result = await mealsCollection.insertOne(item);
            res.send(result);
        });

        // 10. Get Meals by Specific Chef
        app.get('/meals/chef/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { chefEmail: email };
            const result = await mealsCollection.find(query).toArray();
            res.send(result);
        });

        // 11. Delete a Meal
        app.delete('/meals/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealsCollection.deleteOne(query);
            res.send(result);
        });

        // --- ORDER ROUTES (Protected) ---

        // 12. Save a New Order
        app.post('/orders', verifyToken, async (req, res) => {
            const order = req.body;
            order.orderTime = new Date();
            order.status = 'pending'; // Default status

            const query = {
                userEmail: order.userEmail,
                mealId: order.mealId,
                status: 'pending'
            };

            const existingOrder = await ordersCollection.findOne(query);

            if (existingOrder) {
                const newQuantity = parseInt(existingOrder.quantity) + parseInt(order.quantity);
                const newPrice = parseFloat(existingOrder.price) + parseFloat(order.price);

                const updateDoc = {
                    $set: {
                        quantity: newQuantity,
                        price: newPrice,
                        totalPrice: parseFloat(order.price) * newQuantity,
                        orderTime: new Date()
                    }
                };
                const result = await ordersCollection.updateOne(query, updateDoc);
                res.send(result);
            } else {
                const result = await ordersCollection.insertOne(order);
                res.send(result);
            }
        });

        // 12a. Get Orders by Email (User Side)
        app.get('/orders', verifyToken, async (req, res) => {
            const email = req.query.email;
            if (!email) return res.send([]);
            // Basic security: User can only see their own orders
            if (req.decodedUser.email !== email) return res.status(403).send({ message: 'forbidden' });

            const query = { userEmail: email };
            const result = await ordersCollection.find(query).toArray();
            res.send(result);
        });

        // 13. Delete/Cancel an Order
        app.delete('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ordersCollection.deleteOne(query);
            res.send(result);
        });

        // --- CHEF ORDER MANAGEMENT (Protected) ---

        // 14. GET: Fetch all orders for a specific chef
        app.get('/orders/chef/:chefEmail', verifyToken, async (req, res) => {
            const email = req.params.chefEmail;
            const query = {
                $or: [
                    { chefId: email },
                    { chefEmail: email }
                ]
            };
            const result = await ordersCollection.find(query).toArray();
            res.send(result);
        });

        // 15. PATCH: Update order status
        app.patch('/orders/status/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { orderStatus: status }
            };
            const result = await ordersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // --- STRIPE PAYMENT ROUTES (Protected) ---

        // 16. Create Payment Intent
        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            });
        });

        // 17. Save Payment Info & Update Order
        app.post('/payments', verifyToken, async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);

            const query = { _id: new ObjectId(payment.orderId) };
            const updatedDoc = {
                $set: {
                    paymentStatus: 'paid',
                    transactionId: payment.transactionId
                }
            };
            const updateResult = await ordersCollection.updateOne(query, updatedDoc);

            res.send({ paymentResult, updateResult });
        });

        // 18. Get Single Order by ID
        app.get('/orders/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ordersCollection.findOne(query);
            res.send(result);
        });

        // --- PAYMENT HISTORY (Protected) ---

        // 19. GET Payment History by Email
        app.get('/payments/:email', verifyToken, async (req, res) => {
            if (req.decodedUser.email !== req.params.email) return res.status(403).send({ message: 'forbidden' });
            
            const query = { email: req.params.email };
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });

        // 20. GET ALL Payments (Admin)
        app.get('/payments', verifyToken, async (req, res) => {
            const result = await paymentCollection.find().toArray();
            res.send(result);
        });

        // Ping to confirm connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('FoodChef Server is Sitting');
})

app.listen(port, () => {
    console.log(`FoodChef is cooking on port ${port}`);
})