import mongoose from "mongoose";
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate';

const SectionSchema = new mongoose.Schema({
    SectionName: { type: String, required: true ,unique:true},
    
    Course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    
    Teacher: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Teacher',
        required: true
    },
    
    Student: [
        {
            Reg_No: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Student',
                required: true
            },
            attendance: {
                type: Boolean,
                default: false
            }
        }
    ],
    
    RoomNo: { type: String, required: true },
    
    Day: [{
        Day: { 
            type: [String], 
            enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], 
            required: true 
        },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
         completed: { type: String, enum:['C','P','NA'] },
    }],
    
    capacity: { 
        type: Number, 
        default: 60 
    }
}, { timestamps: true });

SectionSchema.plugin(mongooseAggregatePaginate);

export const Section = mongoose.model('Section', SectionSchema);