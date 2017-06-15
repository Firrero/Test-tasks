var express = require('express');
var bodyParser = require("body-Parser");
var mongo = require('mongodb').MongoClient
    , assert = require('assert');

var request = require("request");
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(express.static('public'));
app.listen(3000, function () {
    console.log('Listening on port 3000!');
});

// Connection URLs
var url = 'mongodb://localhost:27017/Tournament';
var mainUrl = 'http://localhost:3000';

app.post('/resultTournament', function (req,res) {
    var winner = "P1";
    var prize = 2000;
    var winners = [];

    mongo.connect(url, function (err, db) {
        assert.equal(null, err);
        db.collection("tournaments").findOne({"participant.playerId": winner},{participant: {$elemMatch: {playerId: winner}}},function (err, result){

            assert.equal(null,err);
            if(result==null){
                // nothing found
                res.sendStatus(400)
            }else {
                var playerId = result.participant[0].playerId;
                if(result.participant[0].backers==null){
                    winners.push({"playerId":playerId,"prize":prize});
                    modifyPlayer(playerId,prize)
                    res.send({"winners": winners})
                }else{
                    var backers = result.participant[0].backers;
                    prize = prize/(backers.length+1);
                    winners.push({"playerId":playerId,"prize":prize});
                    modifyPlayer(playerId,prize)
                    for(var i=0;i<backers.length;i++){
                        modifyPlayer(backers[i],prize)
                        winners.push({"playerId":backers[i],"prize":prize});
                    }
                    res.send({"winners": winners})
                }
            }
        });
    });

});

app.get('/balance', function (req,res) {
    var playerId = req.query.playerId;

    if(playerId==null){
        res.sendStatus(400);
    }else{
        mongo.connect(url, function (err, db) {
            assert.equal(null, err);
            db.collection("players").findOne({playerId: playerId}, function (err, result) {
                assert.equal(null, err);
                if (result == null) {
                    res.sendStatus(400)
                } else {
                    res.send({"playerId": playerId, "balance": result.points});
                }
            });
        });
    }
});


app.get('/fund', function (req,res) {
    var playerId = req.query.playerId;
    var points = req.query.points;

    if(points<=0 || playerId==null || isNaN(points)){
        res.sendStatus(400);
    }else{

        modifyPlayer(playerId,points);
        res.sendStatus(200);

    }
});


app.get('/take', function (req,res) {
    var playerId = req.query.playerId;
    var points = req.query.points;

    if(points<=0 || playerId==null || isNaN(points)){
        res.sendStatus(400)
    }else{
        mongo.connect(url, function (err, db) {
            assert.equal(null, err);
            db.collection("players").findOne({ playerId: playerId} ,function (err,result) {
                assert.equal(null,err);
                if(result==null){
                    // no such player
                    res.sendStatus(400)
                }else {
                    if (result.points < points) {
                       res.sendStatus(400)
                    } else {
                        modifyPlayer(playerId,-points)
                        res.sendStatus(200)
                    }
                }
            });
        });
    }
});



app.get('/announceTournament', function (req,res) {
    var tournamentId = req.query.tournamentId;
    var deposit = req.query.deposit;

    if(tournamentId == null || deposit<=0 ||  isNaN(deposit)){
        res.sendStatus(400);

    }else {
        mongo.connect(url, function (err, db) {
            assert.equal(null, err);
            db.collection("tournaments").update(
                {
                    tournamentId: tournamentId,

                },{
                    tournamentId: tournamentId,
                    deposit: Number(deposit),
                    participant:[]
                },
                {
                    upsert: true
                },

                function (err, r) {
                    assert.equal(null, err);
                    db.close();
                    res.sendStatus(200)
                });
        });
    }
});

app.get('/joinTournament', function (req,res) {
    var tournamentId = req.query.tournamentId;
    var playerId = req.query.playerId;
    var backersId = req.query.backerId;
    var stop;

    if(playerId == null || tournamentId==null){
        res.sendStatus(400)
    }else {
        mongo.connect(url, function (err, db) {
            assert.equal(null, err);
            db.collection("tournaments").findOne({tournamentId: tournamentId}, function (err, resultTournament) {
                assert.equal(null, err);
                if (resultTournament == null) {
                    res.sendStatus(400)
                } else {
                    db.collection("tournaments").findOne({participant:{ $elemMatch: {playerId: playerId } } }, function (err, result) {
                        assert.equal(null, err);
                        if (result == null) {
                            if(backersId == null ){

                                request(''+mainUrl+'/take?playerId='+playerId+'&points='+resultTournament.deposit+'', function(error, response, body) {
                                    if(body=="Bad Request"){
                                        res.sendStatus(400);
                                    }else{
                                        addToTournament(playerId,backersId,tournamentId);
                                        res.sendStatus(200);
                                    }
                                });

                            }else{

                                request(''+mainUrl+'/take?playerId='+playerId+'&points='+resultTournament.deposit/(backersId.length+1)+'', function(error, response, body) {
                                    if(body=="Bad Request"){
                                        res.sendStatus(400);
                                    }else {
                                       for (var i = 0; i < backersId.length; i++) {
                                           request(''+mainUrl+'/take?playerId=' + backersId[i] + '&points=' + resultTournament.deposit/(backersId.length+1) + '',
                                               function (error, response, body) {
                                               // if any of backers does not have enough mmoney then
                                                if(body==="Bad Request"){

                                                   stop=true;

                                                   removeParticipant(playerId,tournamentId);
                                                   returnMoney(playerId,resultTournament.deposit/(backersId.length+1));

                                                    for(var j=0;j<i;j++){
                                                        if(backersId[j]!=JSON.stringify(response.request.uri.query).substring(10,12)) {
                                                            returnMoney(backersId[j], resultTournament.deposit / (backersId.length + 1));
                                                        }
                                                    }

                                                }else {
                                                    if(!stop){
                                                        addToTournament(playerId, backersId,tournamentId);
                                                    }
                                                }
                                            });

                                            if(stop){
                                                break;
                                            }
                                        }
                                        res.sendStatus(200);
                                    }
                                });
                            }

                        } else {
                            res.sendStatus(400);  // already in db
                        }
                  });
                }
            });
        });
    }



});

function addToTournament(playerId,backersId,tournamentId){

    mongo.connect(url, function (err, db) {
        assert.equal(null, err);
        db.collection("tournaments").update(
            {
                tournamentId: tournamentId

            },{

                $addToSet: {participant: {"playerId":playerId,"backers":backersId}}
            },
            {
                upsert: true
            },

            function (err, r) {
                assert.equal(null, err);
                //Participant added
                db.close();
            });
    });

}

function returnMoney(player,points){

    request(''+mainUrl+'/fund?playerId='+player+'&points='+points+'', function(error, response, body) {

        if(body=="Bad Request"){

        }else{
            // points returned
        }
    });

}

function removeParticipant(player,tournament) {

    mongo.connect(url, function (err, db) {
        assert.equal(null, err);
        db.collection("tournaments").update(
            {
                tournamentId: tournament
            },{
               $pull: {participant: { playerId: player }}
            },
            {
                upsert: true
            },

            function (err, r) {
                assert.equal(null, err);
                db.close();
                //participant deleted
            });

    });
    
}


function modifyPlayer(player,point){
    var playerId = player;
    var points = point;

    mongo.connect(url, function (err, db) {
        assert.equal(null, err);

        db.collection("players").update(
            {
                playerId: playerId
            },
            {
                $inc: {points: Number(points)}
            },
            {
                upsert: true
            }
            , function (err, r) {
                assert.equal(null, err);
                db.close();
            });
    });
}


