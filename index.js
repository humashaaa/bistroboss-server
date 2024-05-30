const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wal4hcq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
console.log(uri);
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const foodCardCollection = client.db("bistroDb").collection("foodCard");
    const reviewCollection = client.db("bistroDb").collection("review");
    const cartCollection = client.db("bistroDb").collection("carts");
    const userCollection = client.db("bistroDb").collection("users");
    const paymentCollection = client.db("bistroDb").collection("payments");

    // jwt api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res.send({ token });
    });

    // middleware
    const verifiedToken = (req, res, next) => {
      console.log("inside verified token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    //  use verify admin after varify token
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users related api

    // get all the users in client side admin
    app.get("/users", verifiedToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // admin

    app.get("/users/admin/:email", verifiedToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // google sign in korar time e bujha jay na je user ager naki new so email db e thakle ar user ke db te add korbo na koekbhabe kora jay 1. email ke unique hishebe kore karon ekekjon user er email unique hoy always, 2. upsert method use kore, 3. email ki db te already exist kore naki sheta exist korle ar db te dhukte dibo na
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // make a user admin
    app.patch(
      "/users/admin/:id",
      verifiedToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // admin delete user
    app.delete("/users/:id", verifiedToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // find multiple document (get all the food in menu page)
    app.get("/menu", async (req, res) => {
      const result = await foodCardCollection.find().toArray();
      res.send(result);
    });
    // admin menu item add korar pore saving menu item in db
    app.post("/menu", verifiedToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await foodCardCollection.insertOne(item);
      res.send(result);
    });
    // find/get all the reviews from database
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // server theke data niye koyta food cart e add korse nav bar e sheta dekhabo so first e shob data load korar jonno api create korlam
    app.get("/carts", async (req, res) => {
      // axiosSequre diye email pathaisi so ekhon email diye backend e data get korar jonno ekhane email query body theke email recieve korte hobe
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // client side theke data server side e neya hocche, client add to cart e korle item server side e post kora hobe
    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      // console.log(cartItem);
      // console.log('hhhhhhh');
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    // delete
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // payment
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // payment related api

    // for payment history page
    app.get("/payments/:email", verifiedToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      console.log("payment info", payment);

      // carefully delete cart item after payment. clean the cart
      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };
      const deleteResult = await cartCollection.deleteMany(query);

      res.send({ paymentResult, deleteResult });
    });

    // stats
    app.get("/admin-stats", verifiedToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await foodCardCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // revenue sum but this is not the best way
      // const payments = await paymentCollection.find().toArray()
      // const revenue = payments.reduce((total, payment) =>total + payment.price, 0)

      // sum revenue in better way. reduce uses korle shob data fetch kore reduce kore output dibe which is not efficient so mongodb thekei sum method us ekore total price jana jay
      const result = await paymentCollection.aggregate([
        {
          $group :{
            _id : null,
            totalRevenue :{
              $sum : '$price'
            }
          }
        }
      ]).toArray()
      const revenue = result.length > 0 ? result[0].totalRevenue : 0;
      res.send({ users, menuItems, orders, revenue });
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
