const {parallel, promiseEvent} = require("junk-bucket/future");
const assert = require("assert");

async function pushObject( f, mud, target ){
	assert(target);
	const to = await target.createWritableStream(f.container + "/" + f.key);
	const from = await mud.forContainer(f.container).createReadableStream(f.key);

	const completed = promiseEvent(to, "finish");
	from.pipe(to);
	return await completed;
}

async function removeObject( f, mud, target ){
	await target.unlink( f.container + "/" + f.key );
}

async function performBackupIteration( changeLog, mud, target){
	//Write objections
	await parallel([
		parallel(changeLog.created.map( f => pushObject(f,mud,target))),
		parallel(changeLog.modified.map( f => pushObject(f,mud,target))),
		parallel(changeLog.destroyed.map( f => removeObject(f, mud, target)))
	]);
	//Write state updates
	if( await target.exists("state") ){
		throw new Error("Appending not decided yet");
	} else {
		// Create the list of objects
		const currentTime = Date.now();
		const changes = {};
		changes[currentTime] = changeLog;
		const state = {
			version: 0,
			changes
		};
		const stateBytes = Buffer.from(JSON.stringify(state), "utf-8");
		await target.putBytes("state", stateBytes);
	}
}

module.exports = {
	performBackupIteration
};
