require('dotenv').config()
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer')
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const crypto = require('crypto');
const LocalStrategy = require('passport-local').Strategy;
const findOrCreate = require('mongoose-findorcreate');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const connection = require('./utils/connection');
const MongoStore = require('connect-mongo');


// IMPORTING MODELS
const User = require('./models/user.js');
const Question = require('./models/question.js');
const Video = require('./models/video');
const Course = require("./models/course");

// CREATING EXPRESS APP
const app = express();


// MIDDLEWARES
app.set('view engine', 'ejs')
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(express.static(__dirname + '/public'));
const isAuth = require('./utils/authMiddlewares').isAuth;
const isAdmin = require('./utils/authMiddlewares').isAdmin;

var topic = "" //Topic of user's quiz
var userQuiz = {}

passport.use(new LocalStrategy(
    function(username, password, cb) {
        User.findOne({ username: username })
            .then((user) => {

                if (!user) { return cb(null, false) }
                
                const isValid = validPassword(password, user.hash, user.salt);
                
                if (isValid) {
                    return cb(null, user);
                } else {
                    return cb(null, false);
                }
            })
            .catch((err) => {   
                cb(err);
            });
}));


  

passport.serializeUser(function(user, cb) {
    cb(null, user.id);
});

passport.deserializeUser(function(id, cb) {
    User.findById(id, function (err, user) {
        if (err) { return cb(err); }
        cb(null, user);
    });
});

passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/google/home",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
  },
  function(accessToken, refreshToken, profile, cb) {
      console.log(profile)
    User.findOrCreate({ googleId: profile.id, username: profile.displayName }, function (err, user) {
      return cb(err, user);
    });
  }
));



app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
        mongoUrl: process.env.DB_STRING
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 
    }
}));

app.use(passport.initialize());
app.use(passport.session());


var storage = multer.diskStorage({
    destination: "./public/uploads/videos",
    filename: (req,file,cb) => {
        cb(null, file.fieldname + '_' + Date.now() + path.extname(file.originalname) )
    }
})

var upload = multer({
    storage: storage
}).single('video');


// ROUTES


app.get('/', (req, res, next) => {
    if (req.isAuthenticated()) {
       res.render("home", { loggedIn: true });
    } else {
        res.render("home", { loggedIn: false });
    }
});

// AUTHENTICATION ROUTES

app.get("/auth/google", passport.authenticate('google', { scope: ["profile"] }));

app.get("/auth/google/home", 
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });

  app.post('/login', passport.authenticate('local', { failureRedirect: '/login-failure', successRedirect: 'home' }), (err, req, res, next) => {
    if (err) next(err);
});


app.post('/register', (req, res, next) => {
    
    const saltHash = genPassword(req.body.password);
    
    const salt = saltHash.salt;
    const hash = saltHash.hash;

    const newUser = new User({
        username: req.body.username,
        hash: hash,
        salt: salt,
        admin: false
    });

    newUser.save()
        .then((user) => {
            console.log(user);
        });

    res.redirect('/');

});


app.get('/logout', (req, res, next) => {
    req.logout();
    res.redirect('/');
});

app.get('/home', (req, res, next) => {
    res.redirect("/")
});

app.get('/login-failure', (req, res, next) => {
    res.send('You entered the wrong password.');
});




// ADMIN ROUTES

app.get("/admin", isAdmin, (req, res) => {
    res.render("admin");
})

app.get("/admin/upload", (req, res) => {
    res.render("videoForm");
})

app.get("/admin/add", (req, res) => {
    res.render("courseForm");
})

app.get("/admin/questions", (req, res) => {
    
})

// FOR UPLOADING VIDEOS

app.post("/admin/add", (req, res) => {
    const newCourse = new Course({
        title: req.body.title,
        description: req.body.description,
        link: req.body.link
    })

    newCourse.save((err) => {
        if(!err){
            res.redirect("/admin");
        }
    })
})

app.post("/admin/upload", upload, (req, res) => {

    const courseName = req.body.courseName;
    const videoName = req.body.videoName;
    // const condition = `videos.${videoName}`
    // console.log("courseName, file", courseName, req.file.filename)

    
    Course.findOneAndUpdate({title: courseName}, { $addToSet: { videoNames: videoName, videos: req.file.filename}}).then((result) => {
        res.redirect("/admin");
    }).catch((err) => {
        console.log(err);
    });
});


// USER ROUTES

app.get("/courses", isAuth, (req, res) => {

        res.render("courses", { loggedIn: true });
    
});


app.get("/courses/:courseName", (req, res) => {

    const courseName = req.params.courseName;
    Course.findOne({title: courseName}).then((result) => {
        res.render("singleCourse", { course: result});
    })
    
})

app.get("/quiz", (req, res) => {
    
    if (req.isAuthenticated()) {

        User.findOne({_id: req.user.id}).then((result) => {
            userQuiz = result.scores;
            
            res.render("quizPage", { loggedIn: true, userQuiz: userQuiz });
        }).catch((err) => {
            console.log(err)
        })
        
     } else {
         res.redirect("/");
     }
})

app.get("/quiz/:topic", (req, res) => {
    topic = req.params.topic;
    res.render("quiz", { topic: topic })
    

});

app.post("/quiz/leaderboard/:topic", (req, res) => {
    const topic = req.params.topic;
    var score = req.body.scoreTotal
    if( score / 10 < 1){
        score = "0" + score;
    }
    var condition =`scores.${topic}`
    console.log("condition: ", condition)
    User.findOneAndUpdate({_id: req.user.id}, { $set: {[condition]: score}}).then((results) => {
        console.log(results)
            console.log("Updated");

            User.find({[condition]: {$exists:true}}).sort({  [condition]: -1}).then((result) =>
    {
        console.log(result)
        res.render("leaderboard", { topic: topic , users: result})
    }
    ).catch((err) => {
        console.log(err);
    })
            
    }).catch((err) => {
        console.log(err)
    })

});

app.get("/quiz/leaderboard/:topic", (req, res) => {
    const topic = req.params.topic;
var condition =`scores.${topic}`
    User.find({[condition]: {$exists:true}}).sort({  [condition]: -1}).then((result) =>
{
    console.log(result)
    res.render("leaderboard", { topic: topic , users: result})
}
).catch((err) => {
    console.log(err);
})
});


app.get("/doubt", isAuth, (req, res) => {
    res.render("query");
})

// app.post("/doubt", (req, res) => {
//     const username = req.body.username;
//     const question = req.body.question;
//     var condition = `questions.${question}`

//     User.findOneAndUpdate({_id: req.user.id}, { $set: {[condition]: " "}})
// })

app.get('/protected-route', isAuth, (req, res, next) => {
    
    res.send("This is protected");
});




app.get('/play', (req, res) => {
    Video.find().sort({ createdAt: -1 })
    .then((result) => {
        res.render("video", {

            videos: result,
            });
    
        }) 
    .catch((err) => {
        console.log(err);
    })   
})




app.listen(3000);




/**
 * -------------- HELPER FUNCTIONS ----------------
 */

/**
 * 
 * @param {*} password - The plain text password
 * @param {*} hash - The hash stored in the database
 * @param {*} salt - The salt stored in the database
 * 
 * This function uses the crypto library to decrypt the hash using the salt and then compares
 * the decrypted hash/salt with the password that the user provided at login
 */
function validPassword(password, hash, salt) {
    var hashVerify = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return hash === hashVerify;
}

/**
 * 
 * @param {*} password - The password string that the user inputs to the password field in the register form
 * 
 * This function takes a plain text password and creates a salt and hash out of it.  Instead of storing the plaintext
 * password in the database, the salt and hash are stored for security
 * 
 * ALTERNATIVE: It would also be acceptable to just use a hashing algorithm to make a hash of the plain text password.
 * You would then store the hashed password in the database and then re-hash it to verify later (similar to what we do here)
 */
function genPassword(password) {
    var salt = crypto.randomBytes(32).toString('hex');
    var genHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    
    return {
      salt: salt,
      hash: genHash
    };
}
