
const getProfile = async (req, res, next) => {
    const {Profile} = req.app.get('models')
    const profile = await Profile.findOne({where: {id: req.get('profile_id') || 0}})
    if(!profile) return res.status(401).end()
    req.profile = profile
    next()
}


const checkClient = async (req, res, next) => {
    const {Profile} = req.app.get('models')
    const profile = await Profile.findOne({where: {id: req.params.userId || 0, type: 'client'}})
    if(!profile) return res.status(401).json({message: "Just for clients"})
    req.profile = profile
    next()
}
module.exports = {getProfile, checkClient}