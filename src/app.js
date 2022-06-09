const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model')
const { Op } = require("sequelize");
const { getProfile, checkClient } = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)
const lodash = require('lodash');

/**
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
	const { Contract } = req.app.get('models')
	const contractId = req.params.id;
	const { type, id } = req.profile;
	let searchBy = getKindOfProfile(type, id);
	const contract = await Contract.findOne({
		where: {
			[Op.and]: {
				id: contractId,
				...searchBy
			}
		}
	});
	if (!contract) return res.status(404).end()
	res.json(contract)
});


/**
 * @returns contracts
 */
app.get('/contracts', getProfile, async (req, res) => {
	const { Contract } = req.app.get('models')
	const { type, id } = req.profile;
	let searchBy = getKindOfProfile(type, id);

	const contracts = await Contract.findAll({
		where: {
			[Op.and]: {
				...searchBy,
			},
			[Op.not]: {
				status: 'terminated'
			}
		}
	});
	if (contracts.length === 0) return res.status(404).end()
	res.json(contracts)
});

/**
 * @returns unpaid jobs
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
	const { Contract, Job } = req.app.get('models')
	const { type, id } = req.profile;
	let searchBy = getKindOfProfile(type, id);

	const jobs = await Job.findAll({
		include: {
			model: Contract,
			required: true,
			where: {
				[Op.and]: {
					...searchBy,
					status: 'in_progress',
					paid: sequelize.literal("paid IS NULL"),
				}
			}
		}
	});

	if (jobs.length === 0) return res.status(404).end()
	res.json(jobs)
});

/**
 * @returns message and boolean: if the payment was successful = true if not = false
 */
app.post('/jobs/:job_id/pay', checkClient, async (req, res) => {
	try {
		const { Contract, Job, Profile } = req.app.get('models')
		const { id, balance } = req.profile;
		const contractId = req.params.job_id;
		let searchBy = {
			ClientId: id
		}
		let payForJob = false;
		const job = await Job.findOne({
			include: {
				model: Contract,
				required: true,
				where: {
					[Op.and]: {
						...searchBy,
						id: contractId,
						status: 'in_progress',
						paid: sequelize.literal("paid IS NULL"),
					}
				}
			}
		});
		if (!job) return res.status(404).end()
		payForJob = (balance >= job.price);

		if (!payForJob) {
			res.json({ message: 'Client doesnt have enough money to pay for the job', status: false })
		}
		job['paid'] = true;
		job['paymentDate'] = new Date().toISOString();
		await job.save();
	
		const client = await getProfileInfo(id, Profile);
		let clientBalance = client.balance - job.price;
		client.balance = clientBalance;
		await client.save();
	
		const contractorId = job.Contract.ContractorId;
		const contractor = await getProfileInfo(contractorId, Profile);
		let contractorBalance = contractor.balance + job.price;
		contractor.balance = contractorBalance;
		await contractor.save();
	
		res.json({ message: `Client:${id} already pay the job to the contractor ${contractorId}. Job price: ${job.price}`, status: true });
	} catch(error) {
		console.log(error);
	}
});


/**
 * @returns message and boolean: if the payment was successful = true if not = false
 */
app.post('/balances/deposit/:userId', checkClient, async (req, res) => {
	try {
		const { Contract, Job, Profile } = req.app.get('models')
		const { id } = req.profile;
		let searchBy = {
			ClientId: id
		}
		const jobs = await Job.findAll({
			include: {
				model: Contract,
				required: true,
				where: {
					[Op.and]: {
						...searchBy,
						paid: sequelize.literal("paid IS NULL"),
					}
				}
			}
		});
		if (jobs.length === 0) return res.status(404).end()

		let totalJobsToPay = 0;
		for (const job of jobs) {
			totalJobsToPay += job.price;
		}
		let depositToClient = (totalJobsToPay / 100) * 25; 
		const client = await getProfileInfo(id, Profile);

		let clientBalance = client.balance + depositToClient;
		client.balance = clientBalance;
		await client.save();
	
		res.json({ message: `It was deposited: ${depositToClient} to the client:${id}`, status: true });
	} catch(error) {
		// This error just for debugging
		console.log(error);
	}
});

/**
 * @params the dates are on timestamp format 
 */
app.get('/admin/best-profession', async (req, res) => {
	try {
		const { Contract, Job, Profile } = req.app.get('models')
	
		const start = '2020-08-14T19:11:26.737Z';
		const end = '2020-08-20T19:11:26.737Z';
		const contractsRaw = await Contract.findAll({
			include: [
				{
					model: Profile,
					required: true,
					as: 'Contractor'
				},
				{
					model: Job,
					required: true,
					where: {
						paymentDate: {
							[Op.gte]: start,
							[Op.lt]: end
						}
					}
				}
			]
		});
		if(contractsRaw.length === 0) {
			return res.status(404).end()
		}
		const contracts = JSON.parse(JSON.stringify(contractsRaw));
		const groups = lodash.groupBy(contracts, 'Contractor.profession');
		let jobsByGroup = {};
		for (const group of Object.keys(groups)) {
			let currentGroup = groups[group];
			jobsByGroup[group] = getMoneyPerJobs(currentGroup);
		}

		let topEarner = {
			profession: '', earned: 0
		}
		for (const job in jobsByGroup) {
			topEarner = jobsByGroup[job] > topEarner.earned ?  { profession: job, earned: jobsByGroup[job]} : topEarner;
		}
		res.json(topEarner);
	} catch(error) {
		// This error just for debugging
		console.log(error);
	}
});

function getMoneyPerJobs(currentGroup) {
	let money = 0;
	for (const innerGroup of currentGroup) {
		let Jobs = innerGroup.Jobs;
		for (const job of Jobs) {
			money += job.price;
		}
	}
	return money;
}


async function getProfileInfo(id, Profile) {
	return await Profile.findOne({where: { id }});
}

// IMPORTANT: This function could be in a separate file / folder.
function getKindOfProfile(type, id) {
	let searchBy = {};
	switch (type) {
		case 'client':
			searchBy = {
				ClientId: id
			}
			break;
		case 'contractor':
			searchBy = {
				ContractorId: id
			}
			break;
	}
	return searchBy;
}

module.exports = app;
