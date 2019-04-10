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
	await parallel([
		parallel(changeLog.created.map( f => pushObject(f,mud,target))),
		parallel(changeLog.modified.map( f => pushObject(f,mud,target))),
		parallel(changeLog.destroyed.map( f => removeObject(f, mud, target)))
	]);
}

module.exports = {
	performBackupIteration
};
