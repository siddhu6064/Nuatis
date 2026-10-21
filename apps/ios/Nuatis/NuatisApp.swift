//
//  NuatisApp.swift
//  Nuatis
//
//  Created by Siddhartha Yennamaneni on 9/5/26.
//

import SwiftUI
import NuatisUI

@main
struct NuatisApp: App {
    init() {
        NuatisFontRegistrar.registerIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
