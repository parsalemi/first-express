import express from 'express';
import userdb from '../db/users-db.js';
import productdb from '../db/products-db.js'
import cartdb from '../db/cart-db.js';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cors from 'cors';

const captchaUrl = 'https://www.google.com/recaptcha/api/siteverify?';
const app = express();
dotenv.config();
const corsOptions = {
  origin: 'http://localhost:4200',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  credential: true,
}

app.use(express.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors(corsOptions));

function authToken(req, res, next){
  const authHeader = req.get('Authorization');
  const token = authHeader && authHeader.split(' ')[1];

  if(token == null){
    return res.sendStatus(401);
  }
  jwt.verify(token, process.env.token, (err, user) => {
    if(err){
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  })
}
////////// USERS /////////////
app.get('/api/users', async (req, res) => {
  const users = await userdb.getAllUsers();
  res.status(200).json(users);
});

app.get('/api/users/:id', authToken, async (req, res) => {
  const user = await userdb.getUserById(req.params.id);
  res.status(200).json({
    status: 200,
    data: {
      username: user.username,
      age: user.age,
      gender: user.gender,
    }
  });
});

app.put('/api/users/:id', authToken, async (req, res) => {
  const {username, password, age, gender} = req.body;
  const user = await userdb.getUserById(req.params.id);
  if(user.password == password.currentPassword){
    if(password.newPassword){
      const updatedUserWithPassword = {
        username: username,
        age: age,
        gender: gender,
        password: password.newPassword,
      }
      await userdb.updateUser(req.params.id, updatedUserWithPassword);
      res.status(201).json({
        status: 201,
        id: user.id,
      });
    }
    else {
      const updatedUserWOpassword = {
        username: username,
        age: age,
        gender: gender,
        password: password.currentPassword
      };
      await userdb.updateUser(req.params.id, updatedUserWOpassword);
      res.status(201).json({
        status: 201,
        id: user.id,
      });
    }
  } else {
    res.status(403).json({
      status: 403,
      message: 'wrong password'
    })
  }
});
//////// DELETE USER /////////////
app.post('/api/users/:id/delete', authToken, async (req, res) => {
  const user = await userdb.getUserById(req.params.id);
  const {password} = req.body;
  if(user.password == password){
    await userdb.deleteUser(req.params.id);
    res.status(201).json({success: true});
  }else {
    res.status(401).json({message: 'wrong password'});
  }
});

/////////// SIGN IN ///////////
app.post('/api/users/signin', async (req, res) => {
  const { username, password, recaptcha } = req.body;
  const user = await userdb.getUserByUsername(username);
  const captcha = await fetch(captchaUrl + `secret=${process.env.captchaSecretKey}&response=${recaptcha}`, {
    method: "POST"
  }).then(res => res.json());
  if(captcha.success === true){
    if(!user){
      res.status(401).send('user not found');
    } 
    else if(user.password == password){
      let token = jwt.sign(
      {
        userId: user.id,
        username: user.username
      },
      process.env.token,
      {expiresIn: '1h'}
      );
      res.status(200).json({
        status: 200,
        data: {
          username: user.username,
          age: user.age,
          gender: user.gender,
          token: token
        }
      });
    } 
    else if(user.password !== password){
      res.status(403).json({
        status: 403,
        message: 'wrong password'
      })
    }
  }
});
////////////// REGISTER ///////////////
app.post('/api/users/register', async (req, res) => {
  const { username, password, age, gender, recaptcha } = req.body;
  const userExist = await userdb.getUserByUsername(username);
  const captcha = await fetch(captchaUrl + `secret=${process.env.captchaSecretKey}&response=${recaptcha}`, {
    method: "POST"
  }).then(res => res.json());
  
  if(captcha.success === true){
    if(userExist){
      res.status(403).send('User already exists');
    }else {
      const newUser = {
        username: username,
        password: password.newPassword,
        age: age,
        gender: gender,
      };
      await userdb.createUser(newUser);
      let addedUser = await userdb.getUserByUsername(newUser.username);
      let token = jwt.sign(
        {
          userId: addedUser.id,
          username: addedUser.username
        },
        process.env.token,
        {expiresIn: '1h'}
      );
      res.status(201).json({
        "status": 201,
        data: {
          username: addedUser.username,
          age: addedUser.age,
          gender: addedUser.gender,
          token: token
        }
      });
    }
  }
});
/////////// PRODUCTS //////////
app.get('/api/products', async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'http://localhost:8000/api/products');
  const price = req.query.price;
  if(price){
    const products = await productdb.getProductByPrice(price);
    res.status(200).json(products)
  } else{
    const products = await productdb.getAllProducts();
    res.status(200).json(products);
  }
});

app.get('/api/products/:id', async (req, res) => {
  const product = await productdb.getProductById(req.params.id)
  res.status(200).json(product)
});

///////////// CART ///////////////
app.get('/api/cart/:userid', async (req, res) => {
  const userCart = await cartdb.getCart(req.params.userid);
  if(userCart && userCart.length !== 0){
    res.status(200).json({
      purchased: userCart.purchased, 
      order: userCart.order
    });
  } else {
    res.status(200).send({message: 'you have no cart'})
  }
});

app.post('/api/cart/:userid', async (req, res) => {
  const { productId, name, quantity, price } = req.body;
  const userId = req.params.userid;
  const cart = await cartdb.getCart(userId);
  try {
    if(cart){
      const orderArr = JSON.parse(cart.order);
      const order = { productId, quantity, name, price };
      let itemIndex = orderArr.findIndex(p => p.productId == productId);
      if(itemIndex < 0){
        orderArr.push(order);
      }
      else {
        let product = orderArr[itemIndex];
        product.quantity = product.quantity + 1;
      }
      await cartdb.updateCart(userId, JSON.stringify(orderArr));
      res.status(201).json(cart);
    } 
    else{
      const orderArr = [];
      const order = {productId, name, price, quantity};
      orderArr.push(order);
      await cartdb.addToCart(userId, JSON.stringify(orderArr));
      res.status(201).json(cart);
    }
  } catch(err) {
    console.log(err);
    res.send(500).send('something went wrong');
  }
});

app.patch('/api/cart/:userid/:productid/increase', async (req, res) => {
  const { quantity } = req.body;
  const userId = req.params.userid;
  const productId = req.params.productid;
  const cart = await cartdb.getCart(userId);
  const order = JSON.parse(cart.order);
  const indexOfProduct = order.findIndex(p => p.productId == productId);
  let productObj = order[indexOfProduct];
  let currentQuantity = productObj.quantity;
  productObj.quantity = currentQuantity + quantity;
  await cartdb.updateCart(userId, JSON.stringify(order));
  res.json(order)
});

app.patch('/api/cart/:userid/:productid/decrease', async (req, res) => {
  const { quantity } = req.body;
  const userId = req.params.userid;
  const productId = req.params.productid;
  const cart = await cartdb.getCart(userId);
  const order = JSON.parse(cart.order);
  const indexOfProduct = order.findIndex(p => p.productId == productId);
  if(order.length){
    if(indexOfProduct > -1){
      let productObj = order[indexOfProduct];
      let currentQuantity = productObj.quantity;
      if(currentQuantity > 1){
        productObj.quantity = currentQuantity - quantity;
        await cartdb.updateCart(userId, JSON.stringify(order));
      }
      if(currentQuantity == 1){
        order.splice(indexOfProduct, 1)
        await cartdb.updateCart(userId, JSON.stringify(order));
      }
      res.json(order); 
    }
  } else {
    res.json(order);
  }
});

app.patch('/api/cart/:userid/delete/:productid', async (req, res) => {
  const userId = req.params.userid;
  const {productId} = req.body;
  const cart = await cartdb.getCart(userId);
  let order = JSON.parse(cart.order);
  const indexOfProduct = order.findIndex(p => p.productId == productId);
  console.log(indexOfProduct, productId);
  order.splice(indexOfProduct, 1);
  await cartdb.updateCart(userId, JSON.stringify(order));
  res.status(202).json({message: 'product deleted'});
});

app.post('/api/cart/purchase/:userid', async (req, res) => {
  const { purchased } = req.body;
  const cart = await cartdb.getCart(req.params.userid);
  if(cart.purchased == 0 && purchased == 1){
    await cartdb.purchaseCart(req.params.userid);
    res.status(201).json({message: 'purchased successfully'})
  };
});

app.delete('/api/cart/:userid', async (req, res) => {
  await cartdb.deleteCart(req.params.id);
  res.status(202).send({message: 'Deleted'});
});
// app.get('/users', (req, res) => {
//   const {search} = req.query;
//   const matches = users.filter(user => user.username.includes(search));
//   if(matches){
//     res.json(matches);
//   }else{
//     res.json(users);
//   }
// });

// app.get('/users/:userId', (req, res) => {
//   let {userId} = req.params;
//   let user = users.find(user => user.id == userId);
  
//   if(user){
//     res.json(user);
//   } else {
//     res.sendStatus(404);
//   }
// });

// app.post('/users', (req, res) => {
//   let {username, password} = req.body;
//   let newUser = {
//     id: uuid(),
//     username,
//     password,
//   };
//   users.push(newUser);
//   res.status(201).json(users);
// });

// app.delete('/users/:userId', (req, res) => {
//   let {userId} = req.params;
//   let userIndex = users.findIndex(user => user.id === userId);
//   if(userIndex > -1){
//     users.splice(userIndex, 1);
//   }
//   res.json(users);
// });

// app.put('/users/:userId', (req, res) => {
//   let {userId} = req.params;
//   let {username, age} = req.body;

//   let user = users.find(user => user.id === userId);

//   if(user){
//     user.username = username;
//     user.age = age;
//     res.json(users);
//   } else {
//     res.sendStatus(404);
//   }
// });
app.listen(8000, () => console.log('server is runnig 8000'))