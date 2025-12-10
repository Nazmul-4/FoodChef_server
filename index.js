const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

        // --- TEMPORARY: DATA SEEDING ROUTE ---
        app.get('/add-sample-food', async (req, res) => {
            res.send({ message: "Seeding route exists" });
        });

        // --- PUBLIC ROUTES ---

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

        // --- USERS ROUTES ---

        // 3. Save User on Registration
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

        // 4. Get All Users (Admin only)
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // 5. Update User Role
        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const role = req.body.role;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { role: role }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // 6. Check if User is Admin
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let isAdmin = false;
            if (user) {
                isAdmin = user?.role === 'admin';
            }
            res.send({ admin: isAdmin });
        });

        // 7. Check if User is Chef
        app.get('/users/chef/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let isChef = false;
            if (user) {
                isChef = user?.role === 'chef';
            }
            res.send({ chef: isChef });
        });

        // --- CHEF ROUTES ---

        // 8. Add a New Meal
        app.post('/meals', async (req, res) => {
            const item = req.body;
            const result = await mealsCollection.insertOne(item);
            res.send(result);
        });

        // 9. Get Meals by Specific Chef
        app.get('/meals/chef/:email', async (req, res) => {
            const email = req.params.email;
            const query = { chefEmail: email };
            const result = await mealsCollection.find(query).toArray();
            res.send(result);
        });

        // 10. Delete a Meal
        app.delete('/meals/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealsCollection.deleteOne(query);
            res.send(result);
        });

        // --- ORDER ROUTES ---

        // 11. Save a New Order
        app.post('/orders', async (req, res) => {
            const order = req.body;
            order.orderTime = new Date();
            order.status = 'pending';

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

        // 12. Delete/Cancel an Order
        app.delete('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ordersCollection.deleteOne(query);
            res.send(result);
        });

        // 13. Get Orders by Email
        app.get('/orders', async (req, res) => {
            const email = req.query.email;
            if (!email) {
                return res.send([]);
            }
            const query = { userEmail: email };
            const result = await ordersCollection.find(query).toArray();
            res.send(result);
        });

        // --- CHEF ORDER MANAGEMENT ---

        // 14. GET: Fetch all orders for a specific chef
        app.get('/orders/chef/:chefEmail', async (req, res) => {
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
        app.patch('/orders/status/:id', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { orderStatus: status }
            };
            const result = await ordersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // --- STRIPE PAYMENT ROUTES ---

        // 16. Create Payment Intent
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            console.log("Creating payment intent for:", amount);

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
        app.post('/payments', async (req, res) => {
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
        app.get('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ordersCollection.findOne(query);
            res.send(result);
        });

        // --- NEW ROUTE: PAYMENT HISTORY (Added here) ---

        // 19. GET Payment History by Email
        app.get('/payments/:email', async (req, res) => {
            const query = { email: req.params.email };
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });
        // 20. GET ALL Payments (For Admin Dashboard)
        app.get('/payments', async (req, res) => {
            // In a real app, you should add verifyToken and verifyAdmin middleware here
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