/*
 * Cryptography adaption
 */
const crypto = require("crypto");
const {promisify} = require("util");

const crypto_random = promisify(crypto.randomBytes);
const crypto_scrypt = promisify(crypto.scrypt);

/*
 * Streams
 */
const {Transform, Writable, Readable} = require("stream");

class ToJSON extends Transform {
	constructor() {
		super({objectMode:true});
	}

	_transform( object, encoding, cb ){
		let err, value;
		try {
			value = JSON.stringify(object);
		}catch( e ){
			err = e;
		}
		cb(err, value);
	}
}


class AsBuffer extends Transform {
	constructor() {
		super({writeObjectMode:true, readObjectMode: false});
	}

	_transform( object, encoding, cb ){
		let err, asBytes;
		try {
			asBytes = Buffer.from(object, encoding || "utf-8");
		}catch( e ){
			err = e;
		}
		cb(err, asBytes);
	}
}

class MemoryObjectWritable extends Writable {
	constructor() {
		super({objectMode:true});
		this.objects = [];
	}

	_write(chunk, encoding, callback) {
		try {
			this.objects.push(chunk);
			callback(null);
		}catch(e){
			callback(e);
		}
	}
}

class ToString extends Transform {
	constructor() {
		super({
			readableObjectMode: true,
			writableObjectMode: false
		});
	}

	_transform( object, encoding, cb ){
		let err, asString;
		try {
			asString = object.toString("utf-8");
		}catch( e ){
			err = e;
		}
		cb(err, asString);
	}
}


const {
	MemoryReadable,
	MemoryWritable
} = require("junk-bucket/streams");
const {
	InMemoryVFS
} = require("junk-bucket/vfs");

module.exports ={
	crypto_random,
	crypto_scrypt,
	ToJSON,
	ToString,
	AsBuffer,
	MemoryReadable,
	MemoryWritable,
	MemoryObjectWritable,
	InMemoryVFS
};
