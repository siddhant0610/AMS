import mongoose from "mongoose";
import { DB_Name } from '../constraints.js';;
const connDb=(async()=>{
    try{
      const ConnectionInstance= await mongoose.connect(`${process.env.URI}/${DB_Name}`,)
     console.log(`Database connected Successfully:${ConnectionInstance.connection.host}`)
    }
    catch(err){
        console.error("Error:",err);
        process.exit(1);

    }
})
export default connDb;