const { MongoClient } = require('mongodb');

let db = null;
let client = null;

async function initMongo() {
    if (db) return db.collection('auth');
    
    const uri = process.env.MONGO_URI || "mongodb+srv://tu_usuario:tu_contrasena@cluster.mongodb.net/?retryWrites=true&w=majority";
    client = new MongoClient(uri);
    
    await client.connect();
    db = client.db('team_dronix_bot');
    console.log("📦 Conectado correctamente a MongoDB");
    
    return db.collection('auth');
}

// Données en mémoire locale de secours si MongoDB tarde ou pour les variables rapides
let localData = {
    players: {},
    groups: {}
};

function loadData() {
    return localData;
}

function saveData(data) {
    localData = data;
}

module.exports = { initMongo, loadData, saveData };
