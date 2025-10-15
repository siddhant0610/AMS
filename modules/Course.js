import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate";

const CourseSchema = new mongoose.Schema({
    courseCode: { 
        type: String, 
        required: true, 
        unique: true, 
        uppercase: true,
        trim: true,
        index: true 
    },
    CourseName: { 
        type: String, 
        required: true,
        trim: true 
    },
    department: { 
        type: String, 
        required: true,
        trim: true,
        enum: ['Computer Science', 'Mechanical', 'Electrical', 'Civil', 'IT', 'Electronics']
        // Or use: type: mongoose.Schema.Types.ObjectId, ref: 'Department'
    },
    credits: { 
        type: Number, 
        required: true,
        min: 1,
        max: 6
    },
    semester: { 
        type: Number, 
        required: true,
        min: 1,
        max: 8
    },
    description: { 
        type: String 
    },
    // Don't store students directly - get them from sections
    // students: [...] - REMOVE THIS
    
    // Don't store section name - reference Section model
    sections: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Section'
    }],
    
    // Primary teacher for this course (optional)
    primaryTeacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher'
    },
    
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { timestamps: true });

// Virtual to get all students enrolled in this course (from sections)
CourseSchema.virtual('enrolledStudents', {
    ref: 'Section',
    localField: '_id',
    foreignField: 'Course',
    justOne: false
});

CourseSchema.plugin(mongooseAggregatePaginate);

export const Course = mongoose.model('Course', CourseSchema);
```

---

## **Why This Structure?**

### **Data Flow:**
```
