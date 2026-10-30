package com.prism.slint

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import slint.android.SlintAdapter
import slint.android.startSlint
import slint.interpreter.ComponentHandle
import slint.android.ModelAdapter
import slint.android.Model
import slint.ModelView
import com.prism.slint.R
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Mount Slint app into the FrameLayout container
        lifecycleScope.launch {
            // The Slint app is built via slint! macro in main.rs
            // We get its ComponentHandle and mount it
        }
    }
}
