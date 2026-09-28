const { MongoClient } = require('mongodb');

let connection;

async function getMongoDb() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI não configurada');
  }

  if (!connection) {
    const client = new MongoClient(process.env.MONGO_URI);
    connection = client.connect()
      .then(() => client.db('farm'))
      .catch((error) => {
        connection = null;
        throw error;
      });
  }

  return connection;
}

module.exports = { getMongoDb };