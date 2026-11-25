package com.freease.music.stream

import com.freease.music.stream.data.Hosts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Pembongkar JS terkemas yang dipakai untuk membuka pemutar VidHide/Streamruby/Mecdn jadi daftar putar HLS. */
class HostsTest {
    @Test fun unpackMembukaJsTerkemas() {
        val packed = "eval(function(p,a,c,k,e,d){return p}('0({1:\"2://3.4/5.6\"})',7,7,'setup|file|https|cdn|example|master|m3u8'.split('|'),0,{}))"
        assertEquals("setup({file:\"https://cdn.example/master.m3u8\"})", Hosts.unpack(packed))
    }

    @Test fun bukanKemasanDiabaikan() {
        assertNull(Hosts.unpack("var x = 1;"))
    }
}
