'use strict';

/**
 * DEVELOPMENT NOTE
 *
 * THIS FILE IS UNDER ACTIVE DEVELOPMENT AND IS EXPLICITLY EXCLUDED FROM IMMUTABILITY GUARANTEES
 *
 * If you use api methods in this file, be prepared that they may be removed or modified with no warning.
 */

const nconf = require('nconf');

const db = require('../database');
const activitypub = require('../activitypub');
const user = require('../user');
const posts = require('../posts');

const activitypubApi = module.exports;

activitypubApi.follow = async (caller, { uid: actorId } = {}) => {
	const object = await activitypub.getActor(caller.uid, actorId);
	if (!object) {
		throw new Error('[[error:activitypub.invalid-id]]');
	}

	await activitypub.send(caller.uid, actorId, {
		type: 'Follow',
		object: object.id,
	});
};

activitypubApi.unfollow = async (caller, { uid: actorId }) => {
	const object = await activitypub.getActor(caller.uid, actorId);
	const userslug = await user.getUserField(caller.uid, 'userslug');
	if (!object) {
		throw new Error('[[error:activitypub.invalid-id]]');
	}

	await activitypub.send(caller.uid, actorId, {
		type: 'Undo',
		object: {
			type: 'Follow',
			actor: `${nconf.get('url')}/user/${userslug}`,
			object: object.id,
		},
	});

	await Promise.all([
		db.sortedSetRemove(`followingRemote:${caller.uid}`, object.id),
		db.decrObjectField(`user:${caller.uid}`, 'followingRemoteCount'),
	]);
};

activitypubApi.create = {};

activitypubApi.create.post = async (caller, { pid }) => {
	const post = (await posts.getPostSummaryByPids([pid], caller.uid, { stripTags: false })).pop();
	if (!post) {
		return;
	}

	const [object, followers] = await Promise.all([
		activitypub.mocks.note(post),
		db.getSortedSetMembers(`followersRemote:${post.user.uid}`),
	]);

	const { to, cc } = object;
	const targets = new Set(followers);
	const parentId = await posts.getPostField(object.inReplyTo, 'uid');
	if (activitypub.helpers.isUri(parentId)) {
		to.unshift(parentId);
	}

	const payload = {
		type: 'Create',
		to,
		cc,
		object,
	};

	await activitypub.send(caller.uid, Array.from(targets), payload);
};

activitypubApi.update = {};

activitypubApi.update.profile = async (caller, { uid }) => {
	const [object, followers] = await Promise.all([
		activitypub.mocks.actor(uid),
		db.getSortedSetMembers(`followersRemote:${caller.uid}`),
	]);

	await activitypub.send(caller.uid, followers, {
		type: 'Update',
		to: [activitypub._constants.publicAddress],
		cc: [],
		object,
	});
};