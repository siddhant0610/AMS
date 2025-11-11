import express from 'express';
import { verifyJWT } from '../MiddleWares/authentication.js';
import {loginUser} from '../controller/auth.controller.js'
const loginRoute=express.Router();
loginRoute.get('/',verifyJWT,loginUser);
export default loginRoute;